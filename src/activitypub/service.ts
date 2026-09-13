import { eq, count, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { webcrypto } from "node:crypto";
import { hash } from "bcryptjs";
import { randomBytes } from "node:crypto";
import { getDrizzle } from "../core/db";
import { users, topics, comments, apKeys, apActors, apFollowers } from "../core/schema";
import { config } from "../core/config";
import { generateRsaKeyPair } from "./http-signatures";
import { buildActor, buildTopicNote, buildCommentNote } from "./jsonld";
import type { TopicDetail } from "../topics/service";
import type { TopicComment } from "../comments/service";

const subtle = webcrypto.subtle;

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
    })
    .from(apFollowers)
    .innerJoin(apActors, eq(apActors.id, apFollowers.actorId))
    .where(eq(apFollowers.localUserId, userId))
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

/** Fetch a remote actor by its IRI, caching into the DB. */
export async function fetchRemoteActor(iri: string): Promise<RemoteActorRow | null> {
  const cached = await getRemoteActorByRemoteId(iri);
  if (cached) return cached;
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.protocol === "http:" && !(url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(iri, {
      headers: { Accept: "application/activity+json, application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/json|activity\+json|ld\+json/i.test(ct)) return null;
    const doc = (await res.json()) as Rec;
    if (typeof doc.id !== "string") return null;
    return upsertRemoteActor(doc);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    activity: Record<string, unknown>;
  }> = [];

  for (const r of topicRows) {
    const detail = rowToDetail(r);
    const note = buildTopicNote(detail);
    items.push({
      ts: r.createdAt.getTime(),
      publishedAt: r.createdAt.toISOString(),
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
      activity: createActivityHome(note),
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  const page = items.slice(ok.offset, ok.offset + ok.limit);
  return page.map((i) => ({
    kind: (i.activity.object as Rec).type === "Note" ? "topic" : "comment",
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
    authorId: 0,
    authorUsername: r.authorUsername,
    authorAvatar: null,
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

export async function commentNoteById(id: number): Promise<Record<string, unknown> | null> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      authorUsername: users.username,
      topicId: comments.topicId,
      topicSlug: topics.slug,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .where(eq(comments.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const topic = await topicRowById(row.topicId);
  if (!topic) return null;
  return buildCommentNote(
    { id: row.id, topicId: row.topicId, parentId: row.parentId, body: row.body, votesUp: 0, votesDown: 0, createdAt: row.createdAt, authorId: 0, authorUsername: row.authorUsername, authorAvatar: null },
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
        const frag = u.hash.replace(/^#/, "");
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
  const lists = [obj.to, obj.cc];
  for (const list of lists) {
    if (Array.isArray(list)) {
      for (const v of list as unknown[]) {
        if (typeof v !== "string") continue;
        const ref = resolveLocalObject(v);
        if (ref?.kind === "topic") return ref.topicId;
      }
    }
  }
  return null;
}

export async function getGhostUserForRemoteActor(actorId: number): Promise<number | null> {
  const db = getDrizzle();
  const actor = await getRemoteActorById(actorId);
  if (!actor) return null;
  if (actor.localUserId) return actor.localUserId;

  const remoteId = actor.remoteId;
  const hex = Buffer.from(await subtle.digest("SHA-256", new TextEncoder().encode(remoteId))).toString("hex");
  let username = `fed_${hex.slice(0, 12)}`;
  const existing = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (existing) {
    username = `fed_${hex.slice(0, 12)}_${Date.now() % 100000}`;
  }
  const passwordHash = await hash(randomBytes(32).toString("hex"), 10);
  const rows = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      fullName: actor.displayName ?? actor.preferredUsername,
      role: "user",
      avatarUrl: actor.avatarUrl,
      wasEverCommenter: true,
    })
    .returning({ id: users.id });
  const ghostId = rows[0]?.id;
  if (ghostId) {
    await db.update(apActors).set({ localUserId: ghostId }).where(eq(apActors.id, actor.id));
  }
  return ghostId ?? null;
}

export function noteContentToHtml(obj: Record<string, unknown>): string {
  const content = obj.content;
  if (typeof content === "string") return content;
  return "";
}

export async function localUserIdForActor(actorId: number): Promise<number | null> {
  return getGhostUserForRemoteActor(actorId);
}

export async function deleteLocalCommentIfRemoteAuthor(commentId: number, topicId: number, actorId: number): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .select({ authorId: comments.authorId, topicId: comments.topicId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  const comment = rows[0];
  if (!comment || comment.topicId !== topicId) return false;
  const ghostId = await getGhostUserForRemoteActor(actorId);
  if (!ghostId || comment.authorId !== ghostId) return false;
  return true;
}