import { getDrizzle } from "../core/db";
import { comments, topics, users } from "../core/schema";
import { asc, eq, sql } from "drizzle-orm";

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
  return rows;
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
  return rows[0];
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
}): Promise<number> {
  const db = getDrizzle();
  const ids = await db
    .insert(comments)
    .values({
      topicId: opts.topicId,
      parentId: opts.parentId,
      authorId: opts.authorId,
      body: opts.body,
    })
    .returning({ id: comments.id });
  await db
    .update(topics)
    .set({
      commentCount: sql`${topics.commentCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(topics.id, opts.topicId));
  return ids[0]?.id ?? 0;
}