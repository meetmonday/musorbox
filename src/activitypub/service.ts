import { eq, and, count, desc, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDrizzle } from "../core/db";
import { users, topics, comments, apKeys, apActors, apFollowers, apFollowing, apReactions } from "../core/schema";
import { config } from "../core/config";
import { generateRsaKeyPair, signRequest, signUrlFetch } from "./http-signatures";
import { buildActor, buildTopicNote, buildCommentNote, followActivity } from "./jsonld";
import type { TopicDetail } from "../topics/service";
import type { TopicComment } from "../comments/service";

export type ApUserRow = {
  id: number;
  username: string;
  fullName: string | null;
  role: string;
  avatarUrl: string | null;
  country: string | null;
  city: string | null;
  createdAt: Date;
};

export type ApTopicRow = {
  id: number;
  slug: string;
  title: string;
  body: string;
  leadImage: string | null;
  votesUp: number;
  votesDown: number;
  commentCount: number;
  authorUsername: string;
  authorUserId: number;
  createdAt: Date;
  updatedAt: Date | null;
};

export type ApCommentRow = {
  id: number;
  parentId: number | null;
  body: string;
  authorUsername: string;
  topicId: number;
  topicSlug: string;
  topicCommentCount: number;
  topicAuthorUsername: string;
  topicCreatedAt: Date;
  topicUpdatedAt: Date | null;
  createdAt: Date;
};

export type RemoteActorRow = {
  id: number;
  remoteId: string;
  preferredUsername: string;
  host: string;
  displayName: string | null;
  avatarUrl: string | null;
  inboxUrl: string | null;
  sharedInboxUrl: string | null;
  publicKeyPem: string;
  localUserId: number | null;
  createdAt: Date;
  updatedAt: Date | null;
  deletedAt: Date | null;
};

export async function getUserRowByUsername(username: string): Promise<ApUserRow | null> {
  const db = getDrizzle();
  const row = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl,
      country: users.country,
      city: users.city,
      createdAt: users.created_at,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return row[0] ?? null;
}

export async function getUserRowById(userId: number): Promise<ApUserRow | null> {
  const db = getDrizzle();
  const row = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl,
      country: users.country,
      city: users.city,
      createdAt: users.created_at,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row[0] ?? null;
}

export async function getKeyPairForUser(userId: number): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const db = getDrizzle();
  const existing = await db.select().from(apKeys).where(eq(apKeys.userId, userId)).limit(1);
  if (existing[0]) {
    return { privateKeyPem: existing[0].privateKeyPem, publicKeyPem: existing[0].publicKeyPem };
  }
  const pair = await generateRsaKeyPair();
  await db.insert(apKeys).values({ userId, ...pair });
  return pair;
}

export async function actorUrlFor(username: string): Promise<string | null> {
  const user = await getUserRowByUsername(username);
  if (!user) return null;
  return `${config.baseUrl}/users/${user.username}`;
}

export async function buildActorForUser(username: string): Promise<Record<string, unknown> | null> {
  const user = await getUserRowByUsername(username);
  if (!user) return null;
  const pair = await getKeyPairForUser(user.id);
  return buildActor(user, pair.publicKeyPem, `${config.baseUrl}/users/${user.username}#main-key`);
}

/* ── followers ── */

export async function countFollowers(userId: number): Promise<number> {
  const db = getDrizzle();
  const rows = await db
    .select({ n: count(apFollowers.localUserId) })
    .from(apFollowers)
    .where(eq(apFollowers.localUserId, userId));
  return rows[0]?.n ?? 0;
}

export async function listFollowedActorIds(userId: number, limit: number, offset: number): Promise<RemoteActorRow[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: apActors.id,
      remoteId: apActors.remoteId,
      preferredUsername: apActors.preferredUsername,
      host: apActors.host,
      displayName: apActors.displayName,
      avatarUrl: apActors.avatarUrl,
      inboxUrl: apActors.inboxUrl,
      sharedInboxUrl: apActors.sharedInboxUrl,
      publicKeyPem: apActors.publicKeyPem,
      localUserId: apActors.localUserId,
      createdAt: apActors.createdAt,
      updatedAt: apActors.updatedAt,
      deletedAt: apActors.deletedAt,
    })
    .from(apFollowers)
    .innerJoin(apActors, eq(apActors.id, apFollowers.actorId))
    .where(and(eq(apFollowers.localUserId, userId), isNull(apActors.deletedAt)))
    .orderBy(desc(apFollowers.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export function followersPageUrl(username: string, page: number, perPage: number): string {
  return `${config.baseUrl}/users/${username}/followers?page=${page}&size=${perPage}`;
}

export function outboxPageUrl(username: string, page: number, perPage: number): string {
  return `${config.baseUrl}/users/${username}/outbox?page=${page}&size=${perPage}`;
}

/** Unique delivery targets (sharedInbox preferred, then inbox) for the user's followers. */
export async function deliveryTargetsForUser(userId: number): Promise<string[]> {
  const followers = await listFollowedActorIds(userId, 100000, 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of followers) {
    const url = f.sharedInboxUrl ?? f.inboxUrl;
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/* ── following (local user -> remote actor) ── */

export async function countFollowing(userId: number): Promise<number> {
  const db = getDrizzle();
  const rows = await db
    .select({ n: count(apFollowing.localUserId) })
    .from(apFollowing)
    .where(eq(apFollowing.localUserId, userId));
  return rows[0]?.n ?? 0;
}

export async function listFollowingActors(userId: number, limit: number, offset: number): Promise<RemoteActorRow[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: apActors.id,
      remoteId: apActors.remoteId,
      preferredUsername: apActors.preferredUsername,
      host: apActors.host,
      displayName: apActors.displayName,
      avatarUrl: apActors.avatarUrl,
      inboxUrl: apActors.inboxUrl,
      sharedInboxUrl: apActors.sharedInboxUrl,
      publicKeyPem: apActors.publicKeyPem,
      localUserId: apActors.localUserId,
      createdAt: apActors.createdAt,
      updatedAt: apActors.updatedAt,
      deletedAt: apActors.deletedAt,
    })
    .from(apFollowing)
    .innerJoin(apActors, eq(apActors.id, apFollowing.actorId))
    .where(eq(apFollowing.localUserId, userId))
    .orderBy(desc(apFollowing.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export function followingPageUrl(username: string, page: number, perPage: number): string {
  return `${config.baseUrl}/users/${username}/following?page=${page}&size=${perPage}`;
}

export type FollowingUiItem = {
  id: number;
  remoteId: string;
  displayName: string | null;
  preferredUsername: string;
  host: string;
  status: "requested" | "accepted";
};

export async function listFollowingForUi(userId: number): Promise<FollowingUiItem[]> {
  const db = getDrizzle();
  return db
    .select({
      id: apActors.id,
      remoteId: apActors.remoteId,
      displayName: apActors.displayName,
      preferredUsername: apActors.preferredUsername,
      host: apActors.host,
      status: apFollowing.status,
    })
    .from(apFollowing)
    .innerJoin(apActors, eq(apActors.id, apFollowing.actorId))
    .where(eq(apFollowing.localUserId, userId))
    .orderBy(desc(apFollowing.createdAt));
}

/* ── webmentions ── */

export async function isFollowing(localUserId: number, actorId: number): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .select({ localUserId: apFollowing.localUserId })
    .from(apFollowing)
    .where(and(eq(apFollowing.localUserId, localUserId), eq(apFollowing.actorId, actorId)))
    .limit(1);
  return Boolean(rows[0]);
}

export function newFollowIri(localUserIri: string, targetIri: string): string {
  return `${localUserIri}#follows/${encodeURIComponent(targetIri)}/${Date.now()}`;
}

export async function addFollowing(localUserId: number, actorId: number, followIri: string): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .insert(apFollowing)
    .values({ localUserId, actorId, followIri, createdAt: new Date() })
    .onConflictDoUpdate({
      target: [apFollowing.localUserId, apFollowing.actorId],
      set: { followIri, status: "requested", createdAt: new Date() },
    })
    .returning({ localUserId: apFollowing.localUserId });
  return Boolean(rows[0]);
}

export async function getFollowingFollowIri(localUserId: number, actorId: number): Promise<string | null> {
  const db = getDrizzle();
  const rows = await db
    .select({ followIri: apFollowing.followIri })
    .from(apFollowing)
    .where(and(eq(apFollowing.localUserId, localUserId), eq(apFollowing.actorId, actorId)))
    .limit(1);
  return rows[0]?.followIri ?? null;
}

export async function markFollowingAccepted(localUserId: number, actorId: number): Promise<void> {
  const db = getDrizzle();
  await db
    .update(apFollowing)
    .set({ status: "accepted" })
    .where(and(eq(apFollowing.localUserId, localUserId), eq(apFollowing.actorId, actorId)));
}

export async function removeFollowing(localUserId: number, actorId: number): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .delete(apFollowing)
    .where(and(eq(apFollowing.localUserId, localUserId), eq(apFollowing.actorId, actorId)))
    .returning({ localUserId: apFollowing.localUserId });
  return Boolean(rows[0]);
}

/** Resolve `acct:user@host` to an actor IRI via the remote WebFinger endpoint. */
export async function resolveRemoteAcct(acct: string): Promise<string | null> {
  const m = /^acct:([^@]+)@([^@]+)$/i.exec(acct.trim());
  if (!m) return null;
  const query = `.well-known/webfinger?resource=${encodeURIComponent(acct.trim())}`;
  // https first, then plain http for hosts explicitly allowed by the insecure-fetch
  // policy (fetchRemoteDoc rejects http for anything else, so this stays SSRF-safe).
  const doc =
    (await fetchRemoteDoc(`https://${m[2]}/${query}`, { requireId: false })) ??
    (await fetchRemoteDoc(`http://${m[2]}/${query}`, { requireId: false }));
  if (!doc || !Array.isArray(doc.links)) return null;
  for (const link of doc.links as unknown[]) {
    if (!link || typeof link !== "object") continue;
    const l = link as Rec;
    if (l.rel === "self" && typeof l.href === "string") {
      if (typeof l.type === "string" && /activity|ld\+json/i.test(l.type)) return l.href;
    }
  }
  for (const link of doc.links as unknown[]) {
    if (!link || typeof link !== "object") continue;
    const l = link as Rec;
    if (l.rel === "self" && typeof l.href === "string") return l.href;
  }
  return null;
}

export type FollowResult = { ok: boolean; error?: string; actorId?: number };

/**
 * Follow a remote actor from a local account. Accepts either an `acct:user@host`
 * handle (resolved via WebFinger) or a direct actor IRI.
 */
export async function followRemoteActor(localUserId: number, target: string): Promise<FollowResult> {
  const user = await getUserRowById(localUserId);
  if (!user) return { ok: false, error: "Пользователь не найден" };

  const trimmed = target.trim();
  let targetUrl: string;
  if (/^acct:/i.test(trimmed)) {
    const resolved = await resolveRemoteAcct(trimmed);
    if (!resolved) return { ok: false, error: "Не удалось найти аккаунт по WebFinger" };
    targetUrl = resolved;
  } else {
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Некорректный адрес профиля" };
      targetUrl = u.href;
    } catch {
      return { ok: false, error: "Некорректный адрес профиля" };
    }
  }

  const actor = await fetchRemoteActor(targetUrl, { signerUserId: localUserId });
  if (!actor) return { ok: false, error: "Не удалось получить удалённый профиль" };
  if (!actor.sharedInboxUrl && !actor.inboxUrl) return { ok: false, error: "У аккаунта нет inbox" };

  const actorId = actor.id;
  const localUserIri = `${config.baseUrl}/users/${user.username}`;
  const followIri = newFollowIri(localUserIri, actor.remoteId);
  const activity = followActivity(localUserIri, actor.remoteId, followIri);
  const isNew = await addFollowing(localUserId, actorId, followIri);
  const inbox = actor.sharedInboxUrl ?? actor.inboxUrl!;
  const sent = await sendActivityToFollowingInbox(inbox, activity, localUserId);
  if (isNew && !sent) return { ok: false, error: "Follow отправлен, но удалённый сервер не подтвердил приём" };
  if (!isNew && !sent) return { ok: false, error: "Не удалось доставить Follow" };
  return { ok: true, actorId };
}

/** Unfollow a remote actor we are currently following. */
export async function unfollowRemoteActor(localUserId: number, actorId: number): Promise<FollowResult> {
  const user = await getUserRowById(localUserId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  const actor = await getRemoteActorById(actorId);
  if (!actor) return { ok: false, error: "Аккаунт не найден" };
  const savedFollowIri = await getFollowingFollowIri(localUserId, actor.id);
  const removed = await removeFollowing(localUserId, actor.id);
  if (removed) {
    const localUserIri = `${config.baseUrl}/users/${user.username}`;
    const activity = {
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      type: "Undo",
      id: `${localUserIri}#undo/${Date.now()}`,
      actor: localUserIri,
      object: followActivity(localUserIri, actor.remoteId, savedFollowIri ?? undefined),
      to: [actor.remoteId],
    };
    const inbox = actor.sharedInboxUrl ?? actor.inboxUrl;
    if (inbox) await sendActivityToFollowingInbox(inbox, activity, localUserId);
  }
  return { ok: true };
}

/** Delivery helper: sign + POST an activity to a specific inbox using the local user's key. */
async function sendActivityToFollowingInbox(
  inbox: string,
  activity: Record<string, unknown>,
  userId: number,
): Promise<boolean> {
  try {
    const byId = await getUserRowById(userId);
    const username = byId?.username;
    if (!username) return false;
    const { privateKeyPem } = await getKeyPairForUser(userId);
    const keyId = `${config.baseUrl}/users/${username}#main-key`;
    const body = JSON.stringify(activity);
    const { headers } = await signRequest({ method: "POST", url: inbox, body, privateKeyPem, keyId });
    const res = await fetch(inbox, {
      method: "POST",
      headers: { ...headers, Accept: "application/activity+json" },
      body,
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[ap] follow send to ${inbox} failed: ${res.status} ${await res.text().catch(() => "")}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[ap] follow send to ${inbox} error: ${(err as Error)?.message}`);
    return false;
  }
}

/* ── remote actors ── */

export async function getRemoteActorById(id: number): Promise<RemoteActorRow | null> {
  const db = getDrizzle();
  const rows = await db.select().from(apActors).where(eq(apActors.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getRemoteActorByRemoteId(remoteId: string): Promise<RemoteActorRow | null> {
  const db = getDrizzle();
  const rows = await db.select().from(apActors).where(eq(apActors.remoteId, remoteId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertRemoteActor(doc: Record<string, unknown>): Promise<RemoteActorRow> {
  const db = getDrizzle();
  const id = String(doc.id ?? "");
  let host = "";
  try {
    host = new URL(id).host.toLowerCase();
  } catch {
    host = "unknown";
  }
  const preferredUsername = String(doc.preferredUsername ?? doc.name ?? host.split(".")[0] ?? "remote");
  const displayName = typeof doc.name === "string" ? doc.name : null;
  const avatarUrl = extractAvatar(doc.icon);
  const inboxUrl = typeof doc.inbox === "string" ? doc.inbox : null;
  const sharedInboxUrl =
    typeof doc.endpoints === "object" && doc.endpoints != null && typeof (doc.endpoints as Rec).sharedInbox === "string"
      ? String((doc.endpoints as Rec).sharedInbox)
      : null;
  const publicKeyPem = extractPublicKeyPem(doc);

  const now = new Date();
  const existing = await getRemoteActorByRemoteId(id);
  if (existing) {
    await db
      .update(apActors)
      .set({
        host,
        preferredUsername,
        displayName,
        avatarUrl,
        inboxUrl,
        sharedInboxUrl,
        publicKeyPem: publicKeyPem || existing.publicKeyPem,
        updatedAt: now,
      })
      .where(eq(apActors.id, existing.id));
    return { ...existing, host, preferredUsername, displayName, avatarUrl, inboxUrl, sharedInboxUrl, publicKeyPem, updatedAt: now };
  }
  const rows = await db
    .insert(apActors)
    .values({
      remoteId: id,
      host,
      preferredUsername,
      displayName,
      avatarUrl,
      inboxUrl,
      sharedInboxUrl,
      publicKeyPem,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rows[0]!;
}

type Rec = Record<string, unknown>;

function extractAvatar(icon: unknown): string | null {
  if (typeof icon === "string") {
    return icon.startsWith("https") ? icon : null;
  }
  if (icon && typeof icon === "object") {
    const u = (icon as Rec).url;
    if (typeof u === "string") return u.startsWith("https") ? u : null;
    if (Array.isArray(u)) {
      for (const item of u) {
        if (typeof item === "string" && item.startsWith("https")) return item;
      }
    }
  }
  if (Array.isArray(icon)) {
    for (const item of icon as unknown[]) {
      const v = extractAvatar(item);
      if (v) return v;
    }
  }
  return null;
}

function extractPublicKeyPem(doc: Rec): string {
  const key = doc.publicKey;
  if (Array.isArray(key)) {
    for (const k of key) {
      const pem = extractPublicKeyPem({ publicKey: k });
      if (pem) return pem;
    }
    return "";
  }
  if (key && typeof key === "object") {
    const pem = (key as Rec).publicKeyPem;
    if (typeof pem === "string" && pem.includes("BEGIN")) return pem;
  }
  return "";
}

const MAX_FETCH_REDIRECTS = 5;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Outbound fetch policy for remote actors. Only https is allowed (plus plain
 * http to hosts explicitly listed in `config.allowInsecureFetchHosts`, which
 * defaults to loopback for local dev). A redirect that downgrades to http, or
 * that targets a host outside the policy, is rejected before any connection is
 * made. This keeps an unauthenticated inbox request from being turned into an
 * SSRF probe against internal hosts.
 */
function allowedRemoteFetchUrl(u: URL, wasHttps: boolean): boolean {
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  if (wasHttps) return false;
  return config.allowInsecureFetchHosts.includes(u.hostname.toLowerCase());
}

type FetchSigner = { keyId: string; privateKeyPem: string };

async function fetchRemoteDoc(iri: string, opts: { requireId?: boolean; signerUserId?: number } = {}): Promise<Rec | null> {
  const { requireId = true, signerUserId } = opts;

  // Try unauthenticated first (Pleroma and most instances allow it). If the
  // host rejects it (mastodon.social returns `401 Request not signed` for
  // profile fetches), retry with a signed request whose keyId resolves to one
  // of our own public actors.
  const doc =
    (await fetchRemoteDocScan(iri, { requireId, useSign: false })) ??
    (signerUserId != null ? await fetchRemoteDocScan(iri, { requireId, useSign: true, signerUserId }) : null);
  return doc;
}

async function fetchRemoteDocScan(
  iri: string,
  opts: { requireId: boolean; useSign: boolean; signerUserId?: number },
): Promise<Rec | null> {
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    return null;
  }
  if (!allowedRemoteFetchUrl(url, false)) return null;

  let signer: FetchSigner | null = null;
  if (opts.useSign && opts.signerUserId != null) {
    const user = await getUserRowById(opts.signerUserId);
    if (!user) return null;
    const pair = await getKeyPairForUser(user.id);
    signer = { keyId: `${config.baseUrl}/users/${user.username}#main-key`, privateKeyPem: pair.privateKeyPem };
  }

  for (let hop = 0; hop < MAX_FETCH_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams", application/jrd+json',
          ...(signer ? (await signUrlFetch({ method: "GET", url: url.href, privateKeyPem: signer.privateKeyPem, keyId: signer.keyId })).headers : {}),
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) return null;
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return null;
      }
      if (!allowedRemoteFetchUrl(next, url.protocol === "https:")) return null;
      url = next;
      continue;
    }

    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/json|activity\+json|ld\+json|jrd/i.test(ct)) return null;
    try {
      const doc = (await res.json()) as unknown;
      if (!doc || typeof doc !== "object") return null;
      const rec = doc as Rec;
      if (!opts.requireId) return rec;
      return typeof rec.id === "string" ? rec : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Fetch a remote actor by its IRI, caching into the DB. */
export async function fetchRemoteActor(iri: string, base?: { signerUserId?: number }): Promise<RemoteActorRow | null> {
  const cached = await getRemoteActorByRemoteId(iri);
  if (cached) return cached;

  const doc = await fetchRemoteDoc(iri, { signerUserId: base?.signerUserId });
  if (!doc) return null;

  // Only store an actor whose id we actually asked for: prevents a remote host
  // from aliasing stored keys under a foreign origin (which the signature check
  // in the inbox route would then implicitly trust on later requests).
  try {
    if (new URL(String(doc.id)).origin !== new URL(iri).origin) return null;
  } catch {
    return null;
  }
  return upsertRemoteActor(doc);
}

/** Bypass the actor cache: refetch from the remote origin (used to retry after a key rotation). */
export async function refreshRemoteActor(iri: string, signerUserId?: number): Promise<RemoteActorRow | null> {
  const doc = await fetchRemoteDoc(iri, { signerUserId });
  if (!doc) return null;
  try {
    if (new URL(String(doc.id)).origin !== new URL(iri).origin) return null;
  } catch {
    return null;
  }
  return upsertRemoteActor(doc);
}

/** Fetch an arbitrary ActivityPub object (not actor) by its IRI. */
export async function fetchRemoteObject(iri: string, signerUserId?: number): Promise<Record<string, unknown> | null> {
  return fetchRemoteDoc(iri, { signerUserId });
}

/** Upsert a remote actor from a Person/Service/Application doc. */
export async function refreshActorFromDoc(doc: Record<string, unknown>): Promise<RemoteActorRow | null> {
  const remoteId = String(doc.id ?? "");
  if (!remoteId) return null;
  return upsertRemoteActor(doc);
}

/** Soft-delete a remote actor and remove all follow relations. */
export async function markActorDeleted(remoteActorIri: string): Promise<void> {
  const db = getDrizzle();
  const actor = await getRemoteActorByRemoteId(remoteActorIri);
  if (!actor) return;
  if (actor.deletedAt) return;
  await db
    .update(apActors)
    .set({ deletedAt: new Date() })
    .where(eq(apActors.id, actor.id));
  // Remove follow relationships where this actor participates.
  await db.delete(apFollowers).where(eq(apFollowers.actorId, actor.id));
  await db.delete(apFollowing).where(eq(apFollowing.actorId, actor.id));
}

/** Upsert an incoming reaction (Like or Announce). Returns true if newly created. */
export async function upsertReaction(
  actorId: number,
  type: "Like" | "Announce",
  objectUrl: string,
  activityId?: string,
): Promise<boolean> {
  const db = getDrizzle();
  const existing = await db
    .select({ id: apReactions.id })
    .from(apReactions)
    .where(and(eq(apReactions.actorId, actorId), eq(apReactions.type, type), eq(apReactions.objectUrl, objectUrl)))
    .limit(1);
  if (existing[0]) {
    if (activityId) {
      await db.update(apReactions).set({ activityId }).where(eq(apReactions.id, existing[0].id));
    }
    return false;
  }
  const rows = await db
    .insert(apReactions)
    .values({ actorId, type, objectUrl, activityId: activityId ?? null })
    .returning({ id: apReactions.id });
  return rows.length > 0;
}

/** Remove a reaction. Returns true if deleted. */
export async function removeReaction(actorId: number, type: "Like" | "Announce", objectUrl: string): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .delete(apReactions)
    .where(and(eq(apReactions.actorId, actorId), eq(apReactions.type, type), eq(apReactions.objectUrl, objectUrl)))
    .returning({ id: apReactions.id });
  return rows.length > 0;
}

export type ReactionLookup = { type: "Like" | "Announce"; objectUrl: string };

/** Stable key for a local object across its URL forms (legacy #comment-N vs the canonically path form). */
export function reactionObjectKey(ref: LocalObjectRef): string {
  return ref.kind === "topic"
    ? `${config.baseUrl}/topics/${ref.topicId}`
    : `${config.baseUrl}/topics/${ref.topicId}/comments/${ref.commentId}`;
}

/** Resolve an Undo(Like)/Undo(Announce) whose object is a string pointing at the original activity id. */
export async function removeReactionByActivityId(actorId: number, activityId: string): Promise<ReactionLookup | null> {
  const db = getDrizzle();
  const rows = await db
    .select({ type: apReactions.type, objectUrl: apReactions.objectUrl })
    .from(apReactions)
    .where(and(eq(apReactions.actorId, actorId), eq(apReactions.activityId, activityId)))
    .limit(1);
  const found = rows[0];
  if (!found) return null;
  await removeReaction(actorId, found.type, found.objectUrl);
  return { type: found.type, objectUrl: found.objectUrl };
}

/* ── outbox data ── */

export async function countUserPublished(userId: number): Promise<number> {
  const db = getDrizzle();
  const [t, c] = await Promise.all([
    db.select({ n: count(topics.id) }).from(topics).where(eq(topics.authorId, userId)),
    db.select({ n: count(comments.id) }).from(comments).where(eq(comments.authorId, userId)),
  ]);
  return (t[0]?.n ?? 0) + (c[0]?.n ?? 0);
}

export async function listOutboxActivities(
  userId: number,
  ok: { limit: number; offset: number },
): Promise<Array<{ kind: "topic" | "comment"; activity: Record<string, unknown>; publishedAt: string }>> {
  const db = getDrizzle();
  const commentAuthor = alias(users, "comment_author");
  const topicAuthorUser = alias(users, "topic_author_user");
  const commentRows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      authorId: commentAuthor.id,
      authorUsername: commentAuthor.username,
      topicId: topics.id,
      topicSlug: topics.slug,
      topicCommentCount: topics.commentCount,
      topicAuthorUsername: topicAuthorUser.username,
      topicCreatedAt: topics.createdAt,
      topicUpdatedAt: topics.updatedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(commentAuthor, eq(commentAuthor.id, comments.authorId))
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .innerJoin(topicAuthorUser, eq(topicAuthorUser.id, topics.authorId))
    .where(eq(comments.authorId, userId))
    .orderBy(desc(comments.createdAt));

  const topicRows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      body: topics.body,
      leadImage: topics.leadImage,
      votesUp: topics.votesUp,
      votesDown: topics.votesDown,
      commentCount: topics.commentCount,
      authorUsername: users.username,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(eq(topics.authorId, userId))
    .orderBy(desc(topics.createdAt));

  const topicAuthorByTopic = new Map<number, string>();
  for (const r of topicRows) {
    topicAuthorByTopic.set(r.id, r.authorUsername);
  }

  const items: Array<{
    ts: number;
    publishedAt: string;
    kind: "topic" | "comment";
    activity: Record<string, unknown>;
  }> = [];

  for (const r of topicRows) {
    const detail = rowToDetail(r);
    const note = buildTopicNote(detail);
    items.push({
      ts: r.createdAt.getTime(),
      publishedAt: r.createdAt.toISOString(),
      kind: "topic",
      activity: createActivityHome(note),
    });
  }
  for (const r of commentRows) {
    const topicDetail: TopicDetail = rowToDetail({
      id: r.topicId,
      slug: r.topicSlug,
      title: "",
      body: "",
      leadImage: null,
      votesUp: 0,
      votesDown: 0,
      commentCount: r.topicCommentCount,
      authorUsername: r.topicAuthorUsername,
      createdAt: r.topicCreatedAt,
      updatedAt: r.topicUpdatedAt,
    });
    const note = buildCommentNote(commentToTopicComment(r), topicDetail);
    items.push({
      ts: r.createdAt.getTime(),
      publishedAt: r.createdAt.toISOString(),
      kind: "comment",
      activity: createActivityHome(note),
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  const page = items.slice(ok.offset, ok.offset + ok.limit);
  return page.map((i) => ({
    kind: i.kind,
    activity: i.activity,
    publishedAt: i.publishedAt,
  }));
}

function commentToTopicComment(r: ApCommentRow): TopicComment {
  return {
    id: r.id,
    topicId: r.topicId,
    parentId: r.parentId,
    body: r.body,
    votesUp: 0,
    votesDown: 0,
    createdAt: r.createdAt,
    authorId: null,
    remoteActorId: null,
    isRemoteAuthor: false,
    authorName: r.authorUsername,
    authorUsername: r.authorUsername,
    authorHandle: r.authorUsername,
    authorAvatar: null,
    authorProfileUrl: `/users/${r.authorUsername}/`,
    authorIri: null,
  };
}

export async function topicNoteById(id: number): Promise<Record<string, unknown> | null> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      body: topics.body,
      leadImage: topics.leadImage,
      votesUp: topics.votesUp,
      votesDown: topics.votesDown,
      commentCount: topics.commentCount,
      authorUsername: users.username,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(eq(topics.id, id))
    .limit(1);
  if (!rows[0]) return null;
  return buildTopicNote(rowToDetail(rows[0]));
}

/** Resolve the topic a comment belongs to (for permalink / canonical-URL checks). */
export async function commentTopicById(commentId: number): Promise<{ topicId: number; topicSlug: string } | null> {
  const db = getDrizzle();
  const rows = await db
    .select({ topicId: comments.topicId, topicSlug: topics.slug })
    .from(comments)
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .where(eq(comments.id, commentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function commentNoteById(id: number): Promise<Record<string, unknown> | null> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      authorId: comments.authorId,
      remoteActorId: comments.remoteActorId,
      localUsername: users.username,
      remoteIri: apActors.remoteId,
      remoteUsername: apActors.preferredUsername,
      remoteHost: apActors.host,
      topicId: comments.topicId,
      topicSlug: topics.slug,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .where(eq(comments.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const topic = await topicRowById(row.topicId);
  if (!topic) return null;
  const isRemote = row.remoteActorId != null;
  const username = isRemote ? (row.remoteUsername ?? "remote") : (row.localUsername ?? "?");
  return buildCommentNote(
    {
      id: row.id,
      topicId: row.topicId,
      parentId: row.parentId,
      body: row.body,
      votesUp: 0,
      votesDown: 0,
      createdAt: row.createdAt,
      authorId: isRemote ? null : row.authorId ?? null,
      remoteActorId: row.remoteActorId ?? null,
      isRemoteAuthor: isRemote,
      authorName: username,
      authorUsername: username,
      authorHandle: isRemote && row.remoteHost ? `@${username}@${row.remoteHost}` : username,
      authorAvatar: null,
      authorProfileUrl: isRemote ? (row.remoteIri ?? "") : `/users/${username}/`,
      authorIri: isRemote ? row.remoteIri : null,
    },
    topic,
  );
}

async function topicRowById(rowId: number): Promise<TopicDetail | null> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      body: topics.body,
      leadImage: topics.leadImage,
      votesUp: topics.votesUp,
      votesDown: topics.votesDown,
      commentCount: topics.commentCount,
      authorUsername: users.username,
      createdAt: topics.createdAt,
      updatedAt: topics.updatedAt,
    })
    .from(topics)
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(eq(topics.id, rowId))
    .limit(1);
  if (!rows[0]) return null;
  return rowToDetail(rows[0]);
}

function createActivityHome(note: Record<string, unknown>): Record<string, unknown> {
  return {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    type: "Create",
    id: `${note.id}#create`,
    actor: note.attributedTo,
    published: note.published,
    object: note,
    to: note.to,
    cc: note.cc,
  };
}

function rowToDetail(r: {
  id: number;
  slug: string;
  title: string;
  body: string;
  leadImage: string | null;
  votesUp: number;
  votesDown: number;
  commentCount: number;
  authorUsername: string;
  createdAt: Date;
  updatedAt: Date | null;
}): TopicDetail {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    body: r.body,
    leadImage: r.leadImage,
    votesUp: r.votesUp,
    votesDown: r.votesDown,
    commentCount: r.commentCount,
    createdAt: r.createdAt,
    categoryId: 0,
    categorySlug: "",
    categoryName: "",
    authorId: 0,
    authorUsername: r.authorUsername,
    authorAvatar: null,
    tags: [],
    categoryType: "",
    isPinned: false,
    views: 0,
    updatedAt: r.updatedAt,
  };
}

/* ── object resolution (receive side) ── */

export type LocalObjectRef = { kind: "topic"; topicId: number } | { kind: "comment"; topicId: number; commentId: number };

export function resolveLocalObject(iri: string): LocalObjectRef | null {
  try {
    const u = new URL(iri);
    const base = new URL(config.baseUrl);
    if (u.origin !== base.origin) return null;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2 && segs[0] === "topics") {
      const topicId = Number(segs[1]);
      if (Number.isInteger(topicId) && topicId > 0) {
        // Path-based comment ids: /topics/:id/:slug/comments/:cid
        if (segs.length >= 4 && segs[segs.length - 2] === "comments") {
          const commentId = Number(segs[segs.length - 1]);
          if (Number.isInteger(commentId) && commentId > 0) {
            return { kind: "comment", topicId, commentId };
          }
        }
        const frag = u.hash.replace(/^#/, "");
        // Legacy fragment ids: /topics/:id/:slug#comment-N
        if (frag) {
          const m = /^comment-(\d+)$/.exec(frag);
          if (m) return { kind: "comment", topicId, commentId: Number(m[1]) };
        }
        return { kind: "topic", topicId };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function findTopicIdInAddressing(obj: Record<string, unknown>): Promise<number | null> {
  const urls: string[] = [];
  for (const key of ["to", "cc", "context"] as const) {
    const v = obj[key];
    if (typeof v === "string") urls.push(v);
    else if (Array.isArray(v)) for (const x of v as unknown[]) if (typeof x === "string") urls.push(x);
  }
  if (Array.isArray(obj.tag)) {
    for (const t of obj.tag as unknown[]) {
      if (t && typeof t === "object" && typeof (t as { href?: unknown }).href === "string") {
        urls.push((t as { href: string }).href);
      }
    }
  }
  for (const u of urls) {
    const ref = resolveLocalObject(u);
    if (ref?.kind === "topic") return ref.topicId;
  }
  return null;
}

export function noteContentToHtml(obj: Record<string, unknown>): string {
  const content = obj.content;
  if (typeof content === "string") return content;
  return "";
}