import { topicNoteById, commentNoteById, getUserRowById } from "./service";
import { deliverToUserFollowers } from "./deliver";
import { createActivity, deleteActivity } from "./jsonld";
import { config } from "../core/config";

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
  deliverToUserFollowers(createActivity(note), authorUserId);
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