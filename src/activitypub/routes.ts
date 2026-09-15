import { Hono } from "hono";
import { appendFileSync } from "node:fs";
import { getDrizzle } from "../core/db";
import { users, topics, comments } from "../core/schema";
import { eq, count, asc } from "drizzle-orm";
import { config } from "../core/config";
import {
  buildActorForUser,
  getUserRowByUsername,
  countFollowers,
  listFollowedActorIds,
  countUserPublished,
  listOutboxActivities,
  topicNoteById,
  getRemoteActorByRemoteId,
  commentNoteById,
  commentTopicById,
  followersPageUrl,
  outboxPageUrl,
  countFollowing,
  listFollowingActors,
  followingPageUrl,
  followRemoteActor,
  unfollowRemoteActor,
} from "./service";
import { fetchRemoteActor, refreshRemoteActor } from "./service";
import { verifyHttpSignature, parseSignature } from "./http-signatures";
import { processIncomingActivity } from "./receive";
import { buildOrderedCollection, buildOrderedCollectionPage, buildCollection } from "./jsonld";
import type { RemoteActorRow } from "./service";

const app = new Hono({ strict: false });

const ACTIVITY_JSON = "application/activity+json; charset=utf-8";
const LD_JSON =
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"; charset=utf-8';

function wantsJsonLd(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const accept = c.req.header("accept") ?? "";
  return /application\/(activity|ld)\+json/i.test(accept);
}

function jsonResponse(c: any, body: unknown, type: "activity" | "ld" = "activity") {
  const contentType = type === "activity" ? ACTIVITY_JSON : LD_JSON;
  return c.body(JSON.stringify(body), 200, { "Content-Type": contentType });
}

/* ── WebFinger ── */

app.get("/.well-known/webfinger", async (c) => {
  const resource = c.req.query("resource");
  if (!resource) return c.json({ error: "resource query parameter is required" }, 400);

  let username: string | null = null;
  const acct = /^acct:(.+?)@(.+)$/.exec(resource);
  if (acct) {
    const [, name, host] = acct as unknown as [string, string, string];
    if (!matchesHost(host)) return c.json({ error: "unknown host" }, 404);
    username = name;
  } else {
    const ref = resolveActorUrl(resource);
    username = ref;
  }
  if (!username) return c.json({ error: "resource not found" }, 404);

  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "resource not found" }, 404);
  const actorUrl = `${config.baseUrl}/users/${user.username}`;
  const host = new URL(config.baseUrl).host;

  c.header("Content-Type", 'application/jrd+json; charset=utf-8');
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({
    subject: `acct:${user.username}@${host}`,
    aliases: [actorUrl],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorUrl,
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: actorUrl + "/",
      },
    ],
  });
});

function matchesHost(host: string): boolean {
  try {
    return host.toLowerCase() === new URL(config.baseUrl).host.toLowerCase();
  } catch {
    return false;
  }
}

function resolveActorUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length >= 2 && segs[1] === "users") return decodeURIComponent(segs[2] ?? "");
    if (segs.length === 2 && segs[0] === "users") return decodeURIComponent(segs[1] ?? "");
    return null;
  } catch {
    return null;
  }
}

/* ── NodeInfo ── */

const hostMeta = (c: any) => {
  const host = new URL(config.baseUrl).host;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0" xmlns:hm="http://host-meta.net/xrd/1.0">
 <Link rel="lrdd" type="application/xrd+xml" template="https://${host}/.well-known/webfinger?resource={uri}"/>
 <Link rel="http://webfinger.net/rel/profile-page" type="text/html" href="${config.baseUrl}/"/>
</XRD>`;
  return c.body(xml, 200, { "Content-Type": "application/xrd+xml; charset=utf-8" });
};

app.get("/host-meta", hostMeta);
app.get("/.well-known/host-meta", hostMeta);

app.get("/.well-known/nodeinfo", (c) =>
  jsonResponse(c, {
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `${config.baseUrl}/nodeinfo/2.0`,
      },
    ],
  }),
);

app.get("/nodeinfo/2.0", async (c) => {
  const db = getDrizzle();
  const [userCount, topicCount, commentCount] = await Promise.all([
    db.select({ n: count(users.id) }).from(users).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: count(topics.id) }).from(topics).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: count(comments.id) }).from(comments).then((r) => Number(r[0]?.n ?? 0)),
  ]);
  return jsonResponse(c, {
    version: "2.0",
    software: { name: "musorbox", version: "1.0.0" },
    protocols: ["activitypub"],
    services: { inbound: [], outbound: [] },
    openRegistrations: true,
    usage: {
      users: { total: userCount, activeMonth: userCount, activeHalfyear: userCount },
      localPosts: topicCount,
      localComments: commentCount,
    },
    metadata: { nodeName: config.siteName, nodeDescription: config.siteTagline },
  });
});

/* ── Actor ── */

app.get("/users/:username", async (c, next) => {
  const username = c.req.param("username") as string;
  const actor = await buildActorForUser(username);
  if (!actor) return next();
  if (!wantsJsonLd(c)) return next();
  return jsonResponse(c, actor);
});

/* ── Inbox ── */

const MAX_INBOX_SIZE = 1_000_000;
const MAX_TRACKED_IPS = 10_000;
const inboxHits = new Map<string, { time: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (inboxHits.size >= MAX_TRACKED_IPS) {
    for (const [k, v] of inboxHits) {
      if (now - v.time > 60_000) inboxHits.delete(k);
    }
    if (inboxHits.size >= MAX_TRACKED_IPS) inboxHits.clear();
  }
  const entry = inboxHits.get(ip);
  if (!entry || now - entry.time > 60_000) {
    inboxHits.set(ip, { time: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 30;
}

function clientIp(c: any): string {
  return (
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function apDebug(...parts: unknown[]) {
  if (!process.env.AP_DEBUG) return;
  try {
    appendFileSync(
      "/tmp/ap-inbox-debug.log",
      `${new Date().toISOString()} ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`,
    );
  } catch {
    /* noop */
  }
}

app.post("/users/:username/inbox", async (c) => {
  const username = c.req.param("username") as string;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);

  if (rateLimited(clientIp(c))) return c.json({ error: "too many requests" }, 429);

  const raw = await c.req.text();
  if (raw.length > MAX_INBOX_SIZE) return c.json({ error: "payload too large" }, 413);

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  if (!doc || typeof doc !== "object") return c.json({ error: "invalid activity" }, 400);

  const sigHeader = c.req.header("signature") ?? null;
  const authHeader = c.req.header("authorization") ?? null;
  apDebug("inbox", { type: doc.type, actorInDoc: doc.actor, sigHeader, authHeader });
  let sp = parseSignature(sigHeader);
  if (!sp && authHeader) {
    const stripped = authHeader.trim().replace(/^Signature\s+/i, "");
    sp = parseSignature(stripped);
  }
  const keyId = sp?.keyId ?? null;
  let ownerUrl: string | null = null;
  if (keyId) {
    try {
      ownerUrl = keyId.split("#")[0]!;
    } catch {
      ownerUrl = null;
    }
  }
  apDebug("parsed", { keyId, ownerUrl, sp });

  let actor: RemoteActorRow | null = null;
  if (ownerUrl) {
    actor = (await getRemoteActorByRemoteId(ownerUrl)) ?? (await fetchRemoteActor(ownerUrl));
  }
  apDebug("actor lookup", { actorId: actor?.remoteId ?? null, fromCache: actor ? "yes" : "no" });
  if (!actor) {
    apDebug("401 unknown/signed actor");
    return c.json({ error: "unknown/signed actor" }, 401);
  }

  // The request must be signed by the key belonging to the actor that authored the payload.
  if (ownerUrl && !(ownerUrl === actor.remoteId || ownerUrl.startsWith(actor.remoteId + "#"))) {
    apDebug("401 key owner mismatch", { ownerUrl, remoteId: actor.remoteId });
    return c.json({ error: "key owner mismatch" }, 401);
  }
  const docActor = firstString(doc.actor);
  if (docActor && docActor.split("#")[0] !== actor.remoteId) {
    apDebug("401 actor mismatch", { docActor, remoteId: actor.remoteId });
    return c.json({ error: "actor mismatch" }, 401);
  }

  const getHeader = (name: string) => c.req.header(name);
  const verify = (pem: string) =>
    verifyHttpSignature({
      method: "POST",
      path: c.req.path,
      body: raw,
      actorPublicKeyPem: pem,
      sigHeader,
      authHeader,
      sigInputHeader: c.req.header("signature-input"),
      getHeader,
    });
  let ok = await verify(actor.publicKeyPem);
  if (!ok && actor) {
    // Remote may have rotated its key since we cached the actor; refetch and retry once.
    const fresh = await refreshRemoteActor(actor.remoteId);
    if (fresh?.publicKeyPem && fresh.publicKeyPem !== actor.publicKeyPem) {
      ok = await verify(fresh.publicKeyPem);
    }
  }
  if (!ok) {
    apDebug("401 signature", { type: doc.type, keyId, ownerUrl, actorId: actor.remoteId, sp, headers: c.req.raw.headers });
    return c.json({ error: "invalid signature" }, 401);
  }

  await processIncomingActivity(doc, actor, username);
  return c.body("", 202, { "Content-Type": ACTIVITY_JSON });
});

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) for (const item of v) { const s = firstString(item); if (s) return s; }
  if (v && typeof v === "object") { const s = (v as Record<string, unknown>).id; return typeof s === "string" ? s : null; }
  return null;
}

/* ── Outbox ── */

app.get("/users/:username/outbox", async (c) => {
  const username = c.req.param("username") as string;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);

  const total = await countUserPublished(user.id);
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query("size")) || 20));

  if (c.req.query("page") === undefined) {
    return jsonResponse(
      c,
      buildOrderedCollection(total, total > 0 ? outboxPageUrl(username, 1, size) : null),
    );
  }

  const prevPage = page > 1 ? outboxPageUrl(username, page - 1, size) : null;
  const hasNext = page * size < total;
  const nextPage = hasNext ? outboxPageUrl(username, page + 1, size) : null;

  const activities = await listOutboxActivities(user.id, { limit: size, offset: (page - 1) * size });
  return jsonResponse(
    c,
    buildOrderedCollectionPage(
      activities.map((a) => a.activity),
      prevPage,
      nextPage,
      outboxPageUrl(username, page, size),
    ),
  );
});

/* ── Followers / Following ── */

app.get("/users/:username/followers", async (c) => {
  const username = c.req.param("username") as string;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);

  const total = await countFollowers(user.id);
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query("size")) || 20));

  if (c.req.query("page") === undefined) {
    return jsonResponse(
      c,
      buildOrderedCollection(total, total > 0 ? followersPageUrl(username, 1, size) : null),
    );
  }

  const prevPage = page > 1 ? followersPageUrl(username, page - 1, size) : null;
  const hasNext = page * size < total;
  const nextPage = hasNext ? followersPageUrl(username, page + 1, size) : null;

  const rows = await listFollowedActorIds(user.id, size, (page - 1) * size);
  return jsonResponse(
    c,
    buildOrderedCollectionPage(
      rows.map((r) => r.remoteId),
      prevPage,
      nextPage,
      followersPageUrl(username, page, size),
    ),
  );
});

app.get("/users/:username/following", async (c) => {
  const username = c.req.param("username") as string;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);

  const total = await countFollowing(user.id);
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const size = Math.min(100, Math.max(1, Number(c.req.query("size")) || 20));

  if (c.req.query("page") === undefined) {
    return jsonResponse(
      c,
      buildOrderedCollection(total, total > 0 ? followingPageUrl(username, 1, size) : null),
    );
  }

  const prevPage = page > 1 ? followingPageUrl(username, page - 1, size) : null;
  const hasNext = page * size < total;
  const nextPage = hasNext ? followingPageUrl(username, page + 1, size) : null;

  const rows = await listFollowingActors(user.id, size, (page - 1) * size);
  return jsonResponse(
    c,
    buildOrderedCollectionPage(
      rows.map((r) => r.remoteId),
      prevPage,
      nextPage,
      followingPageUrl(username, page, size),
    ),
  );
});

/* ── Follow / Unfollow (local UI) ── */

app.post("/users/:username/follow", async (c: any) => {
  const username = c.req.param("username") as string;
  const me = c.get("user") ?? null;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);
  if (!me || me.id !== user.id) return c.json({ error: "forbidden" }, 403);

  const target = c.req.query("target") ?? (await formField(c, "target"));
  if (!target) return c.json({ error: "target is required" }, 400);

  const result = await followRemoteActor(user.id, target);
  if (c.req.header("accept")?.includes("application/json")) {
    return c.json(result);
  }
  const referer = c.req.header("referer");
  const back = referer && referer.startsWith(config.baseUrl) ? referer : `/users/${username}/`;
  return c.redirect(back, result.ok ? 302 : 303);
});

async function formField(c: any, name: string): Promise<string> {
  try {
    const form = await c.req.parseBody();
    const v = form[name];
    return typeof v === "string" ? v.trim() : "";
  } catch {
    return "";
  }
}

app.post("/users/:username/unfollow", async (c: any) => {
  const username = c.req.param("username") as string;
  const me = c.get("user") ?? null;
  const user = await getUserRowByUsername(username);
  if (!user) return c.json({ error: "unknown actor" }, 404);
  if (!me || me.id !== user.id) return c.json({ error: "forbidden" }, 403);

  const actorId = Number(c.req.query("actor_id")) || 0;
  const result = await unfollowRemoteActor(user.id, actorId);
  if (c.req.header("accept")?.includes("application/json")) {
    return c.json(result);
  }
  return c.redirect(c.req.header("referer") ?? `/users/${username}/`);
});

/* ── Objects (Notes) ── */

app.get("/topics/:id/:slug", async (c, next) => {
  if (!wantsJsonLd(c)) return next();
  const id = Number(c.req.param("id")) || 0;
  const note = await topicNoteById(id);
  if (!note) return c.json({ error: "not found" }, 404);
  return jsonResponse(c, note);
});

app.get("/topics/:id/:slug/replies", async (c) => {
  const id = Number(c.req.param("id")) || 0;
  const note = await topicNoteById(id);
  if (!note) return c.json({ error: "not found" }, 404);

  const db = getDrizzle();
  const rows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.topicId, id))
    .orderBy(asc(comments.createdAt));
  const notes: Record<string, unknown>[] = [];
  for (const r of rows) {
    const n = await commentNoteById(r.id);
    if (n) notes.push(n);
  }
  return c.body(JSON.stringify(buildCollection(notes, notes.length)), 200, { "Content-Type": ACTIVITY_JSON });
});

/* Comment notes are first-class resolvable objects at /topics/:id/:slug/comments/:cid */
app.get("/topics/:id/:slug/comments/:commentId", async (c, next) => {
  const commentId = Number(c.req.param("commentId")) || 0;
  const topicRow = await commentTopicById(commentId);
  if (!topicRow) return next();
  const topicId = Number(c.req.param("id")) || 0;
  if (topicId !== topicRow.topicId) return c.json({ error: "not found" }, 404);
  const note = await commentNoteById(commentId);
  if (!note) return next();
  if (!wantsJsonLd(c)) {
    // HTML browsers: land on the topic page scrolled to the comment.
    const url = `/topics/${topicRow.topicId}/${topicRow.topicSlug}#div_comment_${commentId}`;
    return c.redirect(url, 302);
  }
  return jsonResponse(c, note);
});

export default app;