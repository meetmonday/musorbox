import { topicNoteById, commentNoteById, getUserRowById, getKeyPairForUser, buildActorForUser, getRemoteActorByLocalUserId, resolveLocalObject } from "./service";
import { deliverToUserFollowers, sendActivityToInbox } from "./deliver";
import { createActivity, deleteActivity, updateActivity } from "./jsonld";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import { comments } from "../core/schema";
import { eq } from "drizzle-orm";

async function actorUrlForUserId(userId: number): Promise<string> {
  const user = await getUserRowById(userId);
  return user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
}

export async function notifyTopicCreated(topicId: number, authorUserId: number): Promise<void> {
  const note = await topicNoteById(topicId);
  if (!note) return;
  deliverToUserFollowers(createActivity(note), authorUserId);
}

export async function notifyCommentCreated(commentId: number, authorUserId: number): Promise<void> {
  const note = await commentNoteById(commentId);
  if (!note) return;
  const activity = createActivity(note);
  deliverToUserFollowers(activity, authorUserId);
  await deliverToReplyAuthor(activity, note, authorUserId);
}

/**
 * A reply to a comment should reach the remote author of that comment, even if
 * they are not a follower of ours (e.g. a remote user who posted in a topic we
 * host). The parent comment author is a ghost mirror of a remote actor, so we
 * deliver the Create straight to that actor's inbox.
 */
async function deliverToReplyAuthor(
  activity: Record<string, unknown>,
  note: Record<string, unknown>,
  commentAuthorUserId: number,
): Promise<void> {
  const replyTo = note.inReplyTo;
  if (typeof replyTo !== "string") return;
  const ref = resolveLocalObject(replyTo);
  if (!ref || ref.kind !== "comment") return;

  const db = getDrizzle();
  const parent = await db
    .select({ authorId: comments.authorId, apUrl: comments.apUrl })
    .from(comments)
    .where(eq(comments.id, ref.commentId))
    .limit(1);
  if (!parent[0] || parent[0].apUrl) return;

  const remote = await getRemoteActorByLocalUserId(parent[0].authorId);
  if (!remote) return;
  const inbox = remote.inboxUrl ?? remote.sharedInboxUrl;
  if (!inbox || inbox.startsWith(config.baseUrl)) return;
  await sendActivityToInbox(inbox, activity, commentAuthorUserId);
}

export async function notifyTopicDeleted(topicId: number, authorUserId: number): Promise<void> {
  const user = await getUserRowById(authorUserId);
  const actor = user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
  deliverToUserFollowers(
    deleteActivity(`${config.baseUrl}/topics/${topicId}`, actor),
    authorUserId,
  );
}

export async function notifyCommentDeleted(commentId: number, authorUserId: number): Promise<void> {
  const user = await getUserRowById(authorUserId);
  const actor = user ? `${config.baseUrl}/users/${user.username}` : config.baseUrl;
  const note = await commentNoteById(commentId).catch(() => null);
  const objectUrl = note ? String(note.id) : `${config.baseUrl}/topics/removed/${commentId}`;
  deliverToUserFollowers(deleteActivity(objectUrl, actor), authorUserId);
}

/** Broadcast an actor Update after a profile edit, so remote followers refresh cached metadata. */
export async function notifyProfileUpdated(userId: number): Promise<void> {
  const user = await getUserRowById(userId);
  if (!user) return;
  const actor = await buildActorForUser(user.username);
  if (!actor) return;
  deliverToUserFollowers(updateActivity(actor), userId);
}

/** Refresh the actor document (ensures an AP key exists for the user). */
export async function ensureActorKey(userId: number): Promise<void> {
  await getKeyPairForUser(userId);
}