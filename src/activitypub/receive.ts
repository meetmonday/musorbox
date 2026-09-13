import { getDrizzle } from "../core/db";
import { apFollowers, apActivities, users, topics, comments } from "../core/schema";
import { eq, and } from "drizzle-orm";
import { config } from "../core/config";
import {
  getGhostUserForRemoteActor,
  resolveLocalObject,
  findTopicIdInAddressing,
  getUserRowById,
  type RemoteActorRow,
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
        await sendAccept(doc, actorRow, localUser.id);
      }
    }
    return;
  }

  if (["Accept", "Reject", "Like", "Announce", "EmojiReact", "Update"].includes(type ?? "")) {
    return;
  }

  if (type === "Delete") {
    const objectId = typeof doc.object === "string" ? doc.object : firstString((doc.object as Doc)?.id);
    if (!objectId) return;
    const ref = resolveLocalObject(objectId);
    if (ref?.kind === "comment") {
      await tryDeleteByCommentRef(ref.topicId, ref.commentId, actorRow);
    } else if (!ref) {
      // The object is a remote object id (e.g. a note we imported). Drop it if we imported it as a comment.
      await tryDeleteRemoteCommentByApUrl(objectId, actorRow);
    }
    return;
  }

  if (type === "Create") {
    const obj = (doc.object && typeof doc.object === "object" ? doc.object : null) as Doc | null;
    if (obj) {
      await tryImportRemoteNote(obj, actorRow);
    }
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
  const replyRef = replyTo ? resolveLocalObject(replyTo) : null;

  let topicId: number | null = null;
  let parentId: number | null = null;
  if (replyRef?.kind === "comment") {
    topicId = replyRef.topicId;
    parentId = replyRef.commentId;
  } else if (replyRef?.kind === "topic") {
    topicId = replyRef.topicId;
  }
  if (!topicId) {
    topicId = await findTopicIdInAddressing(obj);
  }
  if (!topicId) return;

  const content = typeof obj.content === "string" ? sanitizeHtml(obj.content).trim().slice(0, 4000) : "";
  if (!content.replace(/<[^>]*>/g, "").trim()) return;

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