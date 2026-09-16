/**
 * Full ActivityPub wipe.
 *
 * Sends signed Delete activities to every reachable remote inbox for:
 *   - every topic and comment ever published by each local user
 *   - the full actor document of each local user (account deletion)
 *
 * This is the only way to clear data that remote platforms (Mastodon,
 * Pleroma, ...) already cached from Create deliveries. A local DB wipe alone
 * never reaches them.
 *
 * Run with the SAME PUBLIC_BASE_URL (and same users/keys in the DB) that was
 * used when the data was originally published — otherwise remote servers will
 * reject the Deletes as signature mismatches and old posts stay up.
 *
 * Usage:
 *   bun run scripts/ap_wipe.ts --yes        # send Deletes, then wipe local DB
 *   bun run scripts/ap_wipe.ts              # send Deletes only
 *   bun run scripts/ap_wipe.ts --dry-run    # print plan, send nothing, wipe nothing
 *   bun run scripts/ap_wipe.ts --yes --force-wipe   # wipe DB even if some servers rejected Delete (their data stays)
 *
 * SAFETY: remote data can only be removed with the ACTOR KEYS stored in the
 * local DB. So a local DB wipe is only performed when every LIVE server has
 * accepted its Delete. Servers that are unreachable (dead test instances)
 * are skipped. Rejected/refused servers block the wipe by default.
 * Delivery state is saved to ap_wipe_state.json after every run.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, getDrizzle } from "../src/core/db";
import { config } from "../src/core/config";
import * as schema from "../src/core/schema";
import { deleteActivity, AS_CONTEXT } from "../src/activitypub/jsonld";
import { signRequest } from "../src/activitypub/http-signatures";
import { deliveryTargetsForUser, buildActorForUser, getUserRowById, getKeyPairForUser } from "../src/activitypub/service";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const wipeLocal = args.has("--yes");
const onlyDeletes = args.has("--only-deletes");
const forceWipe = args.has("--force-wipe");

const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const CONNECT_TIMEOUT_MS = 15_000;
const STATE_FILE = "ap_wipe_state.json";

type LocalUser = { id: number; username: string };

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function assertReachableBaseUrl(): void {
  try {
    const u = new URL(config.baseUrl);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1" && u.hostname !== "::1") {
      console.warn(
        `[ap-wipe] WARNING: baseUrl ${config.baseUrl} не является https. Некоторые удалённые серверы могут не принять Delete.`,
      );
    }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      console.warn(
        `[ap-wipe] INFO: baseUrl ${config.baseUrl} — это localhost. Remotes не смогут перепроверить акторов, что снижает шанс удаления.`,
      );
    }
  } catch {
    throw new Error(`Некорректный config.baseUrl: ${config.baseUrl}`);
  }
}

/** Every inbox we can still reach. Over-sending is safe: servers ignore unknown objects. */
async function collectDeliveryTargets(userId: number, involvedTopicIds: number[]): Promise<string[]> {
  const db = getDrizzle();
  const set = new Set<string>();
  const selfHost = new URL(config.baseUrl).host;

  for (const inbox of await deliveryTargetsForUser(userId)) set.add(inbox);

  const allActors = await db
    .select({ inboxUrl: schema.apActors.inboxUrl, sharedInboxUrl: schema.apActors.sharedInboxUrl })
    .from(schema.apActors)
    .where(isNull(schema.apActors.deletedAt));
  for (const a of allActors) {
    const inbox = a.sharedInboxUrl ?? a.inboxUrl;
    if (!inbox) continue;
    try {
      if (new URL(inbox).host === selfHost) continue;
    } catch {
      continue;
    }
    set.add(inbox);
  }

  if (involvedTopicIds.length) {
    const participants = await db
      .select({ inboxUrl: schema.apActors.inboxUrl, sharedInboxUrl: schema.apActors.sharedInboxUrl })
      .from(schema.comments)
      .innerJoin(schema.apActors, eq(schema.apActors.id, schema.comments.remoteActorId))
      .where(and(inArray(schema.comments.topicId, involvedTopicIds), isNull(schema.apActors.deletedAt)));
    for (const p of participants) {
      const inbox = p.sharedInboxUrl ?? p.inboxUrl;
      if (!inbox) continue;
      try {
        if (new URL(inbox).host === selfHost) continue;
      } catch {
        continue;
      }
      set.add(inbox);
    }
  }

  return [...set];
}

type ObjectDelete = { kind: "topic" | "comment"; url: string };

async function planForUser(user: LocalUser): Promise<{ objects: ObjectDelete[]; targets: string[] }> {
  const db = getDrizzle();
  const base = config.baseUrl;

  const topicsByAuthor = await db
    .select({ id: schema.topics.id, slug: schema.topics.slug })
    .from(schema.topics)
    .where(eq(schema.topics.authorId, user.id));

  const commentsByAuthor = await db
    .select({ id: schema.comments.id, topicId: schema.comments.topicId })
    .from(schema.comments)
    .where(eq(schema.comments.authorId, user.id));

  const slugByTopic = new Map<number, string>();
  for (const t of topicsByAuthor) slugByTopic.set(t.id, t.slug);

  const missing = new Set(commentsByAuthor.map((c) => c.topicId));
  if (missing.size) {
    const rows = await db
      .select({ id: schema.topics.id, slug: schema.topics.slug })
      .from(schema.topics)
      .where(inArray(schema.topics.id, [...missing]));
    for (const r of rows) slugByTopic.set(r.id, r.slug);
  }

  const objects: ObjectDelete[] = [];
  const involvedTopicIds = new Set<number>();
  for (const t of topicsByAuthor) {
    objects.push({ kind: "topic", url: `${base}/topics/${t.id}/${t.slug}` });
    involvedTopicIds.add(t.id);
  }
  for (const c of commentsByAuthor) {
    const slug = slugByTopic.get(c.topicId);
    if (!slug) continue;
    objects.push({ kind: "comment", url: `${base}/topics/${c.topicId}/${slug}/comments/${c.id}` });
    involvedTopicIds.add(c.topicId);
  }

  const targets = await collectDeliveryTargets(user.id, [...involvedTopicIds]);
  return { objects, targets };
}

/* ── delivery engine ── */

type DeliverResult = { ok: boolean; status?: number; message?: string };

type InboxStats = {
  inbox: string;
  ok: number;
  fail: number;
  skip: number;
  state: "untouched" | "ok" | "dead" | "rejected";
  lastError?: string;
};

const inboxStats = new Map<string, InboxStats>();

/**
 * Persist/restore delivery state so a crash mid-run doesn't lose the record:
 * what is confirmed-ok, and what failed per inbox. On re-run we re-attempt
 * everything except servers confirmed dead (unreachable), and the local DB
 * wipe stays blocked while any live server still rejected a Delete.
 * The state file is the ONLY record that survives a DB wipe.
 */
function saveStateFile(): void {
  const data = {
    savedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    forced: forceWipe,
    inboxes: [...inboxStats.values()].map(({ inbox, ok, fail, skip, state, lastError }) => ({
      inbox,
      ok,
      fail,
      skip,
      state,
      lastError,
    })),
  };
  try {
    Bun.write(STATE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[ap-wipe] Не удалось сохранить ${STATE_FILE}:`, (err as Error)?.message);
  }
}

async function loadStateFile(): Promise<void> {
  try {
    const raw = Bun.file(STATE_FILE);
    if (!raw.exists()) return;
    const data = JSON.parse(await raw.text()) as {
      inboxes?: Array<{
        inbox: string;
        ok?: number;
        fail?: number;
        skip?: number;
        state?: InboxStats["state"];
        lastError?: string;
      }>;
    };
    for (const item of data.inboxes ?? []) {
      // Учитываем только подтверждённые сбои: мёртвые пропускаем, отклонённые
      // пробуем ещё раз, но не забываем их при решении про вайп.
      const st = statFor(item.inbox);
      st.ok = item.ok ?? 0;
      st.fail = item.fail ?? 0;
      st.skip = item.skip ?? 0;
      st.lastError = item.lastError;
      st.state = item.state ?? "untouched";
    }
    const deadN = [...inboxStats.values()].filter((s) => s.state === "dead").length;
    if (deadN) console.log(`[ap-wipe] Из ${STATE_FILE} восстановлено: ${deadN} недоступных серверов (будут пропущены).`);
  } catch {
    /* битый файл состояния — игнорируем */
  }
}

function statFor(inbox: string): InboxStats {
  let s = inboxStats.get(inbox);
  if (!s) {
    s = { inbox, ok: 0, fail: 0, skip: 0, state: "untouched" };
    inboxStats.set(inbox, s);
  }
  return s;
}

function isDeadError(message: string): boolean {
  return /unable to connect|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|aborted|timeout|closed/i.test(message);
}

/**
 * Signed POST of a single activity. Own copy of the app's `postSigned` so we
 * can capture the exact failure (status/message) instead of a bare boolean.
 */
async function postSigned(inbox: string, activity: Record<string, unknown>, userId: number): Promise<DeliverResult> {
  const user = await getUserRowById(userId);
  if (!user) return { ok: false, message: `локальный пользователь #${userId} не найден` };
  const { privateKeyPem } = await getKeyPairForUser(userId);
  const keyId = `${config.baseUrl}/users/${user.username}#main-key`;
  const body = JSON.stringify(activity);
  const { headers } = await signRequest({ method: "POST", url: inbox, body, privateKeyPem, keyId });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(inbox, {
      method: "POST",
      headers: { ...headers, Accept: "application/activity+json" },
      body,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, message: text.trim().slice(0, 160) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error)?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function postWithRetry(inbox: string, activity: Record<string, unknown>, userId: number): Promise<DeliverResult> {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    const r = await postSigned(inbox, activity, userId);
    if (r.ok) return r;
    if (r.status && r.status >= 400 && r.status < 500) return r; // 4xx бессмысленно ретраить
    if (isDeadError(r.message ?? "")) return r; // сеть мертва — ретраить нечего
    if (i < attempts) await sleep(1500 * 2 ** (i - 1));
  }
  return { ok: false, message: "превышено число попыток" };
}

/**
 * Send one activity to a list of inboxes. Dead inboxes (unreachable) are
 * blacklisted for the rest of the run so failed local test servers don't spam
 * the log and slow everything down. Returns per-user counters.
 */
async function deliverBatch(
  activity: Record<string, unknown>,
  inboxes: string[],
  userId: number,
  label: string,
  concurrency = 6,
): Promise<{ ok: number; fail: number; skip: number }> {
  const queue = [...inboxes];
  let ok = 0;
  let fail = 0;
  let skip = 0;
  let done = 0;
  const total = queue.length;

  const inFlight = new Set<Promise<void>>();
  const render = () =>
    process.stdout.write(
      `\r[ap-wipe] ${label}: ${done}/${total} (ok=${ok}, fail=${fail}, skip=${skip})`,
    );

  const work = (inbox: string) =>
    (async () => {
      const st = statFor(inbox);
      if (st.state === "dead") {
        st.skip++;
        skip++;
        done++;
        return;
      }
      const r = await postWithRetry(inbox, activity, userId);
      if (r.ok) {
        st.ok++;
        st.state = "ok";
        ok++;
      } else {
        st.fail++;
        st.lastError = r.status ? `HTTP ${r.status} ${r.message ?? ""}`.trim() : r.message;
        if (isDeadError(r.message ?? "")) st.state = "dead";
        else st.state = "rejected";
        fail++;
      }
      done++;
      render();
    })();

  for (const inbox of queue) {
    const p = work(inbox);
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
    if (inFlight.size >= concurrency) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  process.stdout.write("\n");
  return { ok, fail, skip };
}

/** Inboxes where the actor Delete was accepted (account wiped there) or that are dead. */
function actorDeleteOutcome(targets: string[]): { pending: string[]; okInboxes: Set<string> } {
  const pending: string[] = [];
  const okInboxes = new Set<string>();
  for (const inbox of targets) {
    const st = statFor(inbox);
    if (st.state === "ok") okInboxes.add(inbox);
    if (st.state !== "ok" && st.state !== "dead") pending.push(inbox);
  }
  return { pending, okInboxes };
}

async function sendDeletes(): Promise<void> {
  const db = getDrizzle();
  const localUsers = await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users);

  if (localUsers.length === 0) {
    console.log("[ap-wipe] Локальных пользователей нет, отправлять нечего.");
    return;
  }

  const plan = new Map<number, { user: LocalUser; objects: ObjectDelete[]; targets: string[] }>();
  let totalObjects = 0;
  for (const user of localUsers) {
    const p = await planForUser(user);
    plan.set(user.id, { user, ...p });
    totalObjects += p.objects.length;
    console.log(
      `[ap-wipe] ${user.username}: ${p.objects.length} объектов (topics+comments) -> ${p.targets.length} inbox`,
    );
  }
  console.log(`[ap-wipe] Итого объектов к удалению: ${totalObjects}, пользователей: ${localUsers.length}`);

  if (dryRun) {
    console.log("[ap-wipe] --dry-run: ничего не отправляю.");
    return;
  }

  for (const { user, objects, targets } of plan.values()) {
    const actorIri = `${config.baseUrl}/users/${user.username}`;
    const actorDoc = await buildActorForUser(user.username);

    if (actorDoc) {
      const actorDelete = {
        "@context": [...AS_CONTEXT],
        type: "Delete",
        id: `${actorIri}#delete`,
        actor: actorIri,
        object: actorDoc,
        to: [PUBLIC],
      };
      console.log(`[ap-wipe] ${user.username}: Delete актора -> ${targets.length} inbox`);
      await deliverBatch(actorDelete, targets, user.id, `${user.username}/actor`);
    }

    const { pending } = actorDeleteOutcome(targets);
    // Только там, где актор не был принят (мёртвые/успешные не дублируем):
    // отправляем Delete каждого объекта по отдельности.
    for (const obj of objects) {
      const activity = deleteActivity(obj.url, actorIri);
      await deliverBatch(activity, pending, user.id, `${user.username}/${obj.kind}#${obj.url.split("/").pop()}`);
    }
    console.log(`[ap-wipe] ${user.username}: готов`);
  }

  printSummary();
}

function printSummary(): void {
  const states: InboxStats[] = [...inboxStats.values()];
  const by = (s: string) => states.filter((x) => x.state === s);
  const dead = by("dead");
  const rejected = by("rejected");
  const done = by("ok");

  console.log("\n══════════ Итог рассылки по серверам ══════════");
  console.log(`Успешно (приняли Delete): ${done.length}`);
  console.log(`Недоступны (сеть/мёртвый тестовый сервер): ${dead.length}`);
  console.log(`Отклонили (HTTP-ошибка): ${rejected.length}`);

  if (dead.length) {
    console.log("\n— Недоступны (проверятся не будут, скорее всего сервер выключен):");
    for (const s of dead) console.log(`  ${s.inbox}  (${s.lastError ?? "нет связи"})`);
  }
  if (rejected.length) {
    console.log("\n— Отклонили Delete (внимательно: тут данные могли НЕ удалиться):");
    for (const s of rejected) console.log(`  ${s.inbox}  (${s.lastError ?? "ошибка"})`);
  }
  if (done.length) {
    console.log("\n— Приняли Delete (актор/объекты удалены на стороне площадки):");
    for (const s of done) console.log(`  ${s.inbox}  (ok=${s.ok}, fail=${s.fail})`);
  }
}

async function wipeLocalDb(): Promise<void> {
  if (!wipeLocal) {
    console.log("[ap-wipe] Локальная БД НЕ тронута (нужен флаг --yes для полного вайпа).");
    return;
  }

  /* ГЕЙТ: ключи к Delete живут в БД. Если хоть один живой сервер отклонил
     Delete, локальную БД сносить нельзя — иначе удалить там уже нечем.
     Требуется явный --force-wipe, и пользователь должен понимать риски. */
  if (!dryRun) saveStateFile();
  const rejected = [...inboxStats.values()].filter((s) => s.state === "rejected");
  const dead = [...inboxStats.values()].filter((s) => s.state === "dead");
  if (rejected.length && !forceWipe) {
    console.error(
      `[ap-wipe] ОСТАНОВКА: ${rejected.length} живой(-ых) сервер(-а) не принял(-и) Delete — ` +
        `данные там НЕ удалены. База НЕ сносится, ключи сохранены.`,
    );
    for (const s of rejected) {
      console.error(`  - ${s.inbox}  (${s.lastError ?? "ошибка"})`);
    }
    console.error(
      "[ap-wipe] Когда они начнут отвечать — просто запустите bun run ap:wipe --yes ещё раз.\n" +
        "[ap-wipe] Снести базу ВСЁ РАВНО (данные на этих серверах останутся): bun run ap:wipe --yes --force-wipe",
    );
    process.exit(2);
  }
  if (dead.length && !forceWipe) {
    console.log(`[ap-wipe] ${dead.length} сервер(-ов) недоступны (вероятно выключены) — на них удалить не получится.`);
  }

  const db = getDb();
  const tables = [
    "ap_keys",
    "votes",
    "topic_tags",
    "ap_mentions",
    "ap_reactions",
    "ap_activities",
    "ap_followers",
    "ap_following",
    "comments",
    "topics",
    "tags",
    "sessions",
    "ap_actors",
    "firms",
    "users",
    "categories",
  ];
  console.log("[ap-wipe] Очищаю локальную БД...");
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const t of tables) {
    db.run(`DELETE FROM "${t}"`);
    console.log(`[ap-wipe]   - ${t}: очищена`);
  }
  db.run(`DELETE FROM sqlite_sequence`);
  db.exec("PRAGMA foreign_keys = ON;");
  console.log("[ap-wipe] Локальная БД полностью очищена (схема/миграции сохранены).");
}

(async () => {
  assertReachableBaseUrl();
  await loadStateFile();
  await sendDeletes();
  if (!dryRun) saveStateFile();
  if (!onlyDeletes) await wipeLocalDb();
  console.log("[ap-wipe] Готово.");
})().catch((e) => {
  console.error("[ap-wipe] Ошибка:", e);
  process.exit(1);
});