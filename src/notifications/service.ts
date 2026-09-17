import { and, desc, eq, sql } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { notifications, comments, topics, users, apActors } from "../core/schema";

export async function createNotification(input: typeof notifications.$inferInsert) {
  if (input.actorId === input.userId) return;
  await getDrizzle().insert(notifications).values(input).onConflictDoNothing();
}

export async function notifyComment(commentId: number) {
  const db = getDrizzle();
  const comment = await db.query.comments.findFirst({ where: eq(comments.id, commentId) });
  if (!comment || comment.hidden) return;
  const topic = await db.query.topics.findFirst({ where: eq(topics.id, comment.topicId) });
  if (!topic || topic.hidden) return;
  const recipients = new Map<number, "reply" | "topic_reply" | "mention">();
  recipients.set(topic.authorId, "topic_reply");
  if (comment.parentId) {
    const parent = await db.query.comments.findFirst({ where: eq(comments.id, comment.parentId) });
    if (parent?.authorId) recipients.set(parent.authorId, "reply");
  }
  const names = new Set([...comment.body.replace(/<[^>]*>/g, " ").matchAll(/(?:^|\s)@([A-Za-z0-9_]{3,32})(?![A-Za-z0-9_@])/g)].map((m) => m[1]!));
  for (const name of [...names].slice(0, 20)) {
    const user = await db.query.users.findFirst({ where: eq(users.username, name) });
    if (user && !recipients.has(user.id)) recipients.set(user.id, "mention");
  }
  for (const [userId, type] of recipients) {
    await createNotification({ userId, type, actorId: comment.authorId, remoteActorId: comment.remoteActorId,
      topicId: topic.id, commentId, eventKey: `comment:${commentId}` });
  }
}

export async function listNotifications(userId: number, page: number) {
  return getDrizzle().select({
    id: notifications.id, type: notifications.type, message: notifications.message,
    read: notifications.read, createdAt: notifications.createdAt,
    actorName: users.username, remoteName: apActors.preferredUsername,
    topicId: topics.id, slug: topics.slug, title: topics.title, hidden: topics.hidden,
    commentId: notifications.commentId,
  }).from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(apActors, eq(apActors.id, notifications.remoteActorId))
    .leftJoin(topics, eq(topics.id, notifications.topicId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.id)).limit(21).offset((page - 1) * 20);
}

export async function markRead(userId: number, id?: number) {
  await getDrizzle().update(notifications).set({ read: true })
    .where(and(eq(notifications.userId, userId), id ? eq(notifications.id, id) : sql`1=1`));
}
