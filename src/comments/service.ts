import { getDrizzle } from "../core/db";
import { comments, topics, users } from "../core/schema";
import { asc, eq, sql } from "drizzle-orm";
import { notifyCommentCreated, notifyCommentDeleted } from "../activitypub/notify";
import { hydrateAuthorHandles, isGhostUsername, stripLeadingReplyMentions } from "../core/utils";

/** Drop the auto-added reply mention prefix from third-party (federated) comments. */
function cleanGhostBody(c: TopicComment): TopicComment {
  return isGhostUsername(c.authorUsername) ? { ...c, body: stripLeadingReplyMentions(c.body) } : c;
}

export type TopicComment = {
  id: number;
  topicId: number;
  parentId: number | null;
  body: string;
  votesUp: number;
  votesDown: number;
  createdAt: Date;
  authorId: number;
  authorUsername: string;
  authorAvatar: string | null;
  authorHandle?: string | null;
};

export async function getComments(topicId: number): Promise<TopicComment[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: comments.id,
      topicId: comments.topicId,
      parentId: comments.parentId,
      body: comments.body,
      votesUp: comments.votesUp,
      votesDown: comments.votesDown,
      createdAt: comments.createdAt,
      authorId: users.id,
      authorUsername: users.username,
      authorAvatar: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.topicId, topicId))
    .orderBy(asc(comments.createdAt));
  return (await hydrateAuthorHandles(rows)).map(cleanGhostBody);
}

export async function getCommentById(commentId: number): Promise<TopicComment | undefined> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: comments.id,
      topicId: comments.topicId,
      parentId: comments.parentId,
      body: comments.body,
      votesUp: comments.votesUp,
      votesDown: comments.votesDown,
      createdAt: comments.createdAt,
      authorId: users.id,
      authorUsername: users.username,
      authorAvatar: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.id, commentId))
    .limit(1);
  const comment = (await hydrateAuthorHandles(rows))[0];
  return comment ? cleanGhostBody(comment) : undefined;
}

export async function getCommentCount(topicId: number): Promise<number> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.topicId, topicId));
  return rows.length;
}

export async function addComment(opts: {
  topicId: number;
  parentId: number | null;
  authorId: number;
  body: string;
  apUrl?: string | null;
}): Promise<number> {
  const db = getDrizzle();
  const ids = await db
    .insert(comments)
    .values({
      topicId: opts.topicId,
      parentId: opts.parentId,
      authorId: opts.authorId,
      body: opts.body,
      apUrl: opts.apUrl ?? null,
    })
    .returning({ id: comments.id });
  await db
    .update(topics)
    .set({
      commentCount: sql`${topics.commentCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(topics.id, opts.topicId));
  const id = ids[0]?.id ?? 0;
  if (id && !opts.apUrl) void notifyCommentCreated(id, opts.authorId);
  return id;
}

export async function getCommentChildrenCount(commentId: number): Promise<number> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.parentId, commentId));
  return rows.length;
}

export async function deleteComment(commentId: number, topicId: number): Promise<void> {
  const db = getDrizzle();
  const author = await db
    .select({ authorId: comments.authorId, apUrl: comments.apUrl })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  await db.delete(comments).where(eq(comments.id, commentId));
  await db
    .update(topics)
    .set({ commentCount: sql`max(${topics.commentCount} - 1, 0)`, updatedAt: new Date() })
    .where(eq(topics.id, topicId));
  if (author[0] && !author[0].apUrl) void notifyCommentDeleted(commentId, topicId, author[0].authorId);
}