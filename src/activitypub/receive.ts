import { getDrizzle } from "../core/db";
import { apFollowers, apActivities, apMentions, users, topics, comments } from "../core/schema";
import { eq, and, sql } from "drizzle-orm";
import { config } from "../core/config";
import {
  getGhostUserForRemoteActor,
  resolveLocalObject,
  findTopicIdInAddressing,
  getUserRowById,
  markFollowingAccepted,
  removeFollowing,
  refreshActorFromDoc,
  markActorDeleted,
  upsertReaction,
  removeReaction,
  removeReactionByActivityId,
  reactionObjectKey,
  fetchRemoteObject,
  type RemoteActorRow,
  type LocalObjectRef,
} from "./service";
import { addComment, deleteComment } from "../comments/service";
import { sanitizeHtml } from "../core/utils";
import { acceptActivity } from "./jsonld";
import { sendActivityToInbox } from "./deliver";

type Doc = Record<string, unknown>;

function firstString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstString(item);
      if (s) return s;
    }
    return null;
  }
  if (v && typeof v === "object") {
    const s = (v as Doc).id;
    return typeof s === "string" ? s : null;
  }
  return null;
}

function firstType(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const t = firstType(item);
      if (t) return t;
    }
    return null;
  }
  if (v && typeof v === "object" && typeof (v as Doc).type === "string") return (v as Doc).type as string;
  return null;
}

function activityId(doc: Doc): string {
  if (typeof doc.id === "string" && doc.id) return doc.id;
  const actor = firstString(doc.actor) ?? "unknown";
  const type = firstType(doc.type) ?? "Activity";
  const object = typeof doc.object === "string" ? doc.object : firstString((doc.object as Doc)?.id) ?? "";
  return `${actor}#${type}/${object}`;
}

async function recordActivity(doc: Doc, actorRow: RemoteActorRow, targetLocalIri: string): Promise<boolean> {
  const id = activityId(doc);
  const db = getDrizzle();
  const existing = await db.select({ id: apActivities.id }).from(apActivities).where(eq(apActivities.id, id)).limit(1);
  if (existing[0]) return false;
  await db
    .insert(apActivities)
    .values({
      id,
      type: firstType(doc.type) ?? "Activity",
      actorId: actorRow.id,
      object: JSON.stringify(doc.object ?? null),
      targetId: targetLocalIri,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return true;
}

async function findLocalUser(username: string): Promise<{ id: number } | null> {
  const db = getDrizzle();
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  return rows[0] ?? null;
}

/** Extract plain-text content from an ActivityStreams object, falling back to contentMap. */
function pickContent(obj: Doc): string {
  const content = obj.content;
  if (typeof content === "string" && content) return content;
  if (Array.isArray(content)) {
    for (const c of content) if (typeof c === "string" && c) return c;
  }
  // contentMap: { "en": "...", "ru": "...", ... }  — pick first non-empty value.
  const cmap = obj.contentMap;
  if (cmap && typeof cmap === "object" && !Array.isArray(cmap)) {
    for (const v of Object.values(cmap as Record<string, unknown>)) {
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}

/** Render a content warning. Adds `<details><summary>` wrapper if `sensitive` + summary. */
function renderContentWithCw(obj: Doc, bodyHtml: string): string {
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!summary) return bodyHtml;
  // <details> + <summary> are in allowedBodyTags in utils.ts (added for AP interop).
  return `<details class="ap-cw"><summary>${sanitizeHtml(summary)}</summary>${bodyHtml}</details>`;
}

export async function processIncomingActivity(doc: Doc, actorRow: RemoteActorRow, localUsername: string): Promise<void> {
  const localUser = await findLocalUser(localUsername);
  if (!localUser) return;
  const localIri = `${config.baseUrl}/users/${localUsername}`;

  const isNew = await recordActivity(doc, actorRow, localIri);
  if (!isNew) return;

  const type = firstType(doc.type);

  if (type === "Follow") {
    const target = firstString(doc.object);
    if (target && (target === localIri || target.startsWith(localIri + "/"))) {
      await upsertFollower(localUser.id, actorRow.id);
      await sendAccept(doc, actorRow, localUser.id);
    }
    return;
  }

  if (type === "Undo") {
    const inner = (doc.object && typeof doc.object === "object" ? doc.object : null) as Doc | null;
    const innerType = inner ? firstType(inner.type) : null;

    if (innerType === "Follow" && inner) {
      const target = firstString(inner.object);
      if (target && (target === localIri || target.startsWith(localIri + "/"))) {
        await removeFollower(localUser.id, actorRow.id);
      }
      return;
    }

    if (innerType === "Like" && inner) {
      const objectUrl = firstString(inner.object);
      if (objectUrl) {
        const ref = resolveLocalObject(objectUrl);
        if (ref) {
          const removed = await removeReaction(actorRow.id, "Like", reactionObjectKey(ref));
          if (removed) await decrementVotesForObject(objectUrl);
        }
      }
      return;
    }

    if (innerType === "Announce" && inner) {
      const objectUrl = firstString(inner.object);
      if (objectUrl) {
        const ref = resolveLocalObject(objectUrl);
        if (ref) await removeReaction(actorRow.id, "Announce", reactionObjectKey(ref));
      }
      return;
    }

    // Mastodon/Pleroma style: the Undo's `object` is a string pointing at the
    // original Like/Announce activity id rather than an embedded activity.
    const objectRef = typeof doc.object === "string" ? firstString(doc.object) : null;
    if (objectRef) {
      const removed = await removeReactionByActivityId(actorRow.id, objectRef);
      if (removed) {
        if (removed.type === "Like") await decrementVotesForObject(removed.objectUrl);
        return;
      }
      // Some broadcasters send the Undo with `object` set to the liked object's
      // URL directly instead of the activity id — fall back to removing by object.
      const ref = resolveLocalObject(objectRef);
      if (ref) {
        const removedByObject = await removeReaction(actorRow.id, "Like", reactionObjectKey(ref));
        if (removedByObject) {
          await decrementVotesForObject(objectRef);
        } else {
          await removeReaction(actorRow.id, "Announce", reactionObjectKey(ref));
        }
      }
    }

    return;
  }

  if (type === "Accept" || type === "Reject") {
    await handleFollowOutcome(doc, actorRow, localUser.id, type);
    return;
  }

  if (type === "Update") {
    const obj = doc.object && typeof doc.object === "object" ? (doc.object as Doc) : null;
    if (!obj) return;
    const objType = firstType(obj.type);
    // Actor (Person/Service/Application/Group) update: refresh cached actor + ghost profile.
    if (objType && ["Person", "Service", "Application", "Group"].includes(objType)) {
      await refreshActorFromDoc(obj);
    } else {
      // Note update
      await tryUpdateRemoteNote(obj, actorRow);
    }
    return;
  }

  if (type === "Delete") {
    const objectId = typeof doc.object === "string" ? doc.object : firstString((doc.object as Doc)?.id);
    if (!objectId) return;
    // Check if it's an actor deletion (the object is the actor IRI itself).
    const isActorDelete =
      objectId === actorRow.remoteId ||
      objectId === firstString(doc.actor);
    if (isActorDelete) {
      await markActorDeleted(objectId);
      return;
    }
    const ref = resolveLocalObject(objectId);
    if (ref?.kind === "comment") {
      await tryDeleteByCommentRef(ref.topicId, ref.commentId, actorRow);
    } else if (!ref) {
      await tryDeleteRemoteCommentByApUrl(objectId, actorRow);
    }
    return;
  }

  if (type === "Like") {
    const objectUrl = firstString(doc.object);
    if (!objectUrl) return;
    const ref = resolveLocalObject(objectUrl);
    if (ref) {
      const ok = await upsertReaction(actorRow.id, "Like", reactionObjectKey(ref), firstString(doc.id) ?? undefined);
      if (ok) await incrementVotesForObject(ref);
    }
    return;
  }

  if (type === "Announce") {
    const objectUrl = firstString(doc.object);
    if (!objectUrl) return;
    const ref = resolveLocalObject(objectUrl);
    if (ref) await upsertReaction(actorRow.id, "Announce", reactionObjectKey(ref), firstString(doc.id) ?? undefined);
    return;
  }

  if (type === "Create") {
    let obj = (doc.object && typeof doc.object === "object" ? doc.object : null) as Doc | null;
    // If Create has an object ID string, fetch the actual object.
    if (!obj && typeof doc.object === "string") {
      const fetched = await fetchRemoteObject(doc.object, localUser.id);
      if (fetched) obj = fetched;
    }
    if (obj) {
      // If object is missing content, try fetching by its id.
      if (!pickContent(obj) && typeof obj.id === "string" && obj.id !== firstString(doc.object)) {
        const fetched = await fetchRemoteObject(String(obj.id), localUser.id);
        if (fetched && pickContent(fetched)) Object.assign(obj, fetched);
      }
      await tryImportRemoteNote(obj, actorRow);
      await recordMentions(obj, actorRow);
    }
    return;
  }

  if (type === "EmojiReact" || type === "Flag" || type === "Move" || type === "Block") {
    return;
  }

  return;
}

async function upsertFollower(localUserId: number, actorId: number): Promise<void> {
  const db = getDrizzle();
  await db
    .insert(apFollowers)
    .values({ localUserId, actorId, createdAt: new Date() })
    .onConflictDoNothing();
}

async function removeFollower(localUserId: number, actorId: number): Promise<void> {
  const db = getDrizzle();
  await db
    .delete(apFollowers)
    .where(and(eq(apFollowers.localUserId, localUserId), eq(apFollowers.actorId, actorId)));
}

/**
 * A remote server accepted (or rejected) a Follow we previously sent from a
 * local account. Marks the following relation as accepted, or drops it on
 * Reject. The Accept's object is normally the original Follow activity whose
 * `object` is our local actor IRI; we verify that when it is available.
 */
async function handleFollowOutcome(
  doc: Doc,
  actorRow: RemoteActorRow,
  localUserId: number,
  outcome: "Accept" | "Reject",
): Promise<void> {
  const localUser = await getUserRowById(localUserId);
  if (!localUser) return;
  const localIri = `${config.baseUrl}/users/${localUser.username}`;

  const obj = doc.object;
  const inner = obj && typeof obj === "object" ? (obj as Doc) : null;
  // The embedded Follow was issued by one of our accounts: its `actor` is our
  // local IRI, while its `object` is the remote account that accepted/rejected.
  const innerActor = inner ? firstString(inner.actor) : null;
  if (innerActor && !(innerActor === localIri || innerActor.startsWith(localIri + "/"))) {
    return;
  }

  if (outcome === "Reject") {
    await removeFollowing(localUserId, actorRow.id);
  } else {
    await markFollowingAccepted(localUserId, actorRow.id);
  }
}

async function sendAccept(followedActivity: Doc, actorRow: RemoteActorRow, localUserId: number): Promise<void> {
  const user = await getUserRowById(localUserId);
  if (!user) return;
  const actorIri = `${config.baseUrl}/users/${user.username}`;
  const accept = acceptActivity(followedActivity, actorIri);
  const inbox = actorRow.inboxUrl ?? actorRow.sharedInboxUrl;
  if (!inbox) return;
  await sendActivityToInbox(inbox, accept, localUserId);
}

async function tryImportRemoteNote(obj: Doc, actorRow: RemoteActorRow): Promise<void> {
  const noteType = firstType(obj.type);
  if (!noteType || !["Note", "Article", "Page", "Question"].includes(noteType)) return;

  const replyTo = firstString(obj.inReplyTo);

  let topicId: number | null = null;
  let parentId: number | null = null;
  if (replyTo) {
    const replyRef = resolveLocalObject(replyTo);
    if (replyRef?.kind === "comment") {
      topicId = replyRef.topicId;
      parentId = replyRef.commentId;
    } else if (replyRef?.kind === "topic") {
      topicId = replyRef.topicId;
    } else if (!replyRef) {
      const db = getDrizzle();
      const row = await db
        .select({ id: comments.id, topicId: comments.topicId })
        .from(comments)
        .where(eq(comments.apUrl, replyTo))
        .limit(1);
      if (row[0]) {
        topicId = row[0].topicId;
        parentId = row[0].id;
      }
    }
  }
  if (!topicId) {
    topicId = await findTopicIdInAddressing(obj);
  }
  if (!topicId) return;

  let content = pickContent(obj);
  content = sanitizeHtml(content).trim();
  const plain = content.replace(/<[^>]*>/g, "").trim();
  if (plain) {
    content = sanitizeHtml(content).slice(0, 4000);
  } else {
    content = "";
  }
  const attachments = extractImageAttachments(obj);
  if (attachments.length) {
    content += `<br clear="all"/>\n` + attachments.map((u) => `<img src="${u}" alt="" loading="lazy"/>`).join("\n");
  }
  if (!content.replace(/<[^>]*>/g, "").trim()) return;
  content = renderContentWithCw(obj, content);

  const db = getDrizzle();
  const topic = await db.select({ id: topics.id }).from(topics).where(eq(topics.id, topicId)).limit(1);
  if (!topic[0]) return;

  const authorId = await getGhostUserForRemoteActor(actorRow.id);
  if (!authorId) return;

  const apUrl = String(obj.id ?? obj.url ?? null);
  if (apUrl) {
    const existing = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.apUrl, apUrl), eq(comments.authorId, authorId)))
      .limit(1);
    if (existing[0]) return;
  }

  await addComment({ topicId, parentId, authorId, body: content, apUrl });
}

async function tryUpdateRemoteNote(obj: Doc, actorRow: RemoteActorRow): Promise<void> {
  const noteType = firstType(obj.type);
  if (!noteType || !["Note", "Article", "Page", "Question"].includes(noteType)) return;
  const apUrl = firstString(obj.id) ?? firstString(obj.url);
  if (!apUrl) return;

  let content = pickContent(obj).trim();
  if (!content.replace(/<[^>]*>/g, "").trim()) return;
  content = renderContentWithCw(obj, sanitizeHtml(content).slice(0, 4000));

  const ghostId = await getGhostUserForRemoteActor(actorRow.id);
  if (!ghostId) return;
  const db = getDrizzle();
  const existing = await db
    .select({ id: comments.id, body: comments.body })
    .from(comments)
    .where(and(eq(comments.apUrl, apUrl), eq(comments.authorId, ghostId)))
    .limit(1);
  if (!existing[0] || existing[0].body === content) return;
  await db.update(comments).set({ body: content }).where(eq(comments.id, existing[0].id));
}

/** Extract https image attachments from an ActivityStreams object. */
function extractImageAttachments(obj: Doc): string[] {
  const attach = obj.attachment;
  if (!Array.isArray(attach)) return [];
  const out: string[] = [];
  for (const a of attach as unknown[]) {
    if (!a || typeof a !== "object") continue;
    const rec = a as Doc;
    const mediaType = String(rec.mediaType ?? rec.type ?? "");
    if (!/^image\/(png|jpe?g|gif|webp|avif)$/i.test(mediaType) && rec.type !== "Image") continue;
    const url = pickMediaUrl(rec);
    if (url && /^https?:\/\//i.test(url) && !/\s/.test(url) && url.length <= 2048) out.push(url);
    if (out.length >= 4) break;
  }
  return out;
}

function pickMediaUrl(rec: Doc): string | null {
  const url = rec.url;
  if (typeof url === "string") return url;
  if (Array.isArray(url)) {
    for (const u of url) if (typeof u === "string") return u;
    return null;
  }
  if (url && typeof url === "object") {
    const s = (url as Doc).href ?? (url as Doc).url;
    if (typeof s === "string") return s;
  }
  return null;
}

async function tryDeleteByCommentRef(topicId: number, commentId: number, actorRow: RemoteActorRow): Promise<void> {
  const ghostId = await getGhostUserForRemoteActor(actorRow.id);
  if (!ghostId) return;
  const db = getDrizzle();
  const comment = await db
    .select({ id: comments.id, authorId: comments.authorId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!comment[0] || comment[0].authorId !== ghostId) return;
  await deleteComment(commentId, topicId);
}

async function tryDeleteRemoteCommentByApUrl(remoteNoteId: string, actorRow: RemoteActorRow): Promise<void> {
  const ghostId = await getGhostUserForRemoteActor(actorRow.id);
  if (!ghostId) return;
  const db = getDrizzle();
  const comment = await db
    .select({ id: comments.id, topicId: comments.topicId })
    .from(comments)
    .where(and(eq(comments.apUrl, remoteNoteId), eq(comments.authorId, ghostId)))
    .limit(1);
  if (!comment[0]) return;
  await deleteComment(comment[0].id, comment[0].topicId);
}

/** A remote Like mapped into the local vote counter (like = +1 upvote). */
async function incrementVotesForObject(ref: LocalObjectRef): Promise<void> {
  const db = getDrizzle();
  if (ref.kind === "topic") {
    await db.update(topics).set({ votesUp: sql`max(${topics.votesUp} + 1, 0)` }).where(eq(topics.id, ref.topicId));
  } else {
    await db
      .update(comments)
      .set({ votesUp: sql`max(${comments.votesUp} + 1, 0)` })
      .where(and(eq(comments.id, ref.commentId), eq(comments.topicId, ref.topicId)));
  }
}

/** Reverse of the Like-to-vote mapping (Undo(Like) = -1, floored at 0). */
async function decrementVotesForObject(objectUrl: string): Promise<void> {
  const ref = resolveLocalObject(objectUrl);
  if (!ref) return;
  const db = getDrizzle();
  if (ref.kind === "topic") {
    await db.update(topics).set({ votesUp: sql`max(${topics.votesUp} - 1, 0)` }).where(eq(topics.id, ref.topicId));
  } else {
    await db
      .update(comments)
      .set({ votesUp: sql`max(${comments.votesUp} - 1, 0)` })
      .where(and(eq(comments.id, ref.commentId), eq(comments.topicId, ref.topicId)));
  }
}

/**
 * Store inbound mentions of local users so they appear on the profile. A note
 * can carry `tag: [{ type: "Mention", name: "@user@host", href: ".../users/user" }]`.
 */
async function recordMentions(obj: Doc, actorRow: RemoteActorRow): Promise<void> {
  const tags = obj.tag;
  if (!Array.isArray(tags)) return;
  const objectUrl = String(obj.id ?? obj.url ?? "");
  if (!objectUrl) return;

  const db = getDrizzle();
  let added = false;
  for (const tag of tags as unknown[]) {
    if (!tag || typeof tag !== "object") continue;
    const rec = tag as Doc;
    if (firstType(rec.type) !== "Mention") continue;

    // Local user targeted by the mention.
    const href = firstString(rec.href);
    let targetId: number | null = null;
    if (href) {
      try {
        const u = new URL(href);
        const segs = u.pathname.split("/").filter(Boolean);
        if (u.origin !== new URL(config.baseUrl).origin) continue;
        if (segs.length >= 2 && segs[segs.length - 2] === "users") {
          const name = decodeURIComponent(segs[segs.length - 1]!);
          if (name.startsWith("fed_")) continue; // ghost accounts aren't mentionable
          const rows = await db.select({ id: users.id }).from(users).where(eq(users.username, name)).limit(1);
          targetId = rows[0]?.id ?? null;
        }
      } catch {
        /* invalid href */
      }
    }

    if (!targetId) continue;
    await db
      .insert(apMentions)
      .values({ actorId: actorRow.id, targetLocalUserId: targetId, objectUrl })
      .onConflictDoNothing();
    added = true;
  }
  if (added) {
    // Debug log so mention delivery can be verified during interop testing.
    if (process.env.AP_DEBUG) console.log(`[ap] mention recorded: ${actorRow.remoteId} -> ${objectUrl}`);
  }
}