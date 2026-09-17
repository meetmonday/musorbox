import { getDrizzle } from "../core/db";
import { comments, topics, users, apActors } from "../core/schema";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { notifyComment } from "../notifications/service";
import { notifyCommentCreated, notifyCommentDeleted } from "../activitypub/notify";
import { stripLeadingReplyMentions } from "../core/utils";

export type TopicComment = {
  id: number;
  topicId: number;
  parentId: number | null;
  body: string;
  votesUp: number;
  votesDown: number;
  createdAt: Date;
  hidden: boolean;
  authorId: number | null;
  remoteActorId: number | null;
  isRemoteAuthor: boolean;
  authorName: string;
  authorUsername: string;
  authorHandle: string;
  authorAvatar: string | null;
  authorProfileUrl: string;
  authorIri?: string | null;
};

const commentSelect = {
  id: comments.id,
  topicId: comments.topicId,
  parentId: comments.parentId,
  body: comments.body,
  votesUp: comments.votesUp,
  votesDown: comments.votesDown,
  createdAt: comments.createdAt,
  hidden: comments.hidden,
  authorId: comments.authorId,
  remoteActorId: comments.remoteActorId,
  localUsername: users.username,
  localFullName: users.fullName,
  localAvatar: users.avatarUrl,
  remoteUsername: apActors.preferredUsername,
  remoteHost: apActors.host,
  remoteDisplayName: apActors.displayName,
  remoteAvatar: apActors.avatarUrl,
  remoteIri: apActors.remoteId,
  remoteDeletedAt: apActors.deletedAt,
};

type CommentRow = {
  id: number;
  topicId: number;
  parentId: number | null;
  body: string;
  votesUp: number;
  votesDown: number;
  createdAt: Date;
  hidden: boolean;
  authorId: number | null;
  remoteActorId: number | null;
  localUsername: string | null;
  localFullName: string | null;
  localAvatar: string | null;
  remoteUsername: string | null;
  remoteHost: string | null;
  remoteDisplayName: string | null;
  remoteAvatar: string | null;
  remoteIri: string | null;
  remoteDeletedAt: Date | null;
};

function toTopicComment(r: CommentRow): TopicComment {
  const remoteId = r.remoteActorId as number | null;
  const remoteActive = remoteId != null && !(r.remoteDeletedAt as Date | null);
  if (remoteActive) {
    const username = (r.remoteUsername as string | null) ?? (r.remoteHost as string | null) ?? "remote";
    const host = (r.remoteHost as string | null) ?? "";
    const name = (r.remoteDisplayName as string | null) ?? username;
    const iri = (r.remoteIri as string | null) ?? "";
    return {
      id: r.id as number,
      topicId: r.topicId as number,
      parentId: r.parentId as number | null,
      body: r.body as string,
      votesUp: r.votesUp as number,
      votesDown: r.votesDown as number,
      createdAt: r.createdAt as Date,
      hidden: Boolean(r.hidden),
      authorId: null,
      remoteActorId: remoteId,
      isRemoteAuthor: true,
      authorName: name,
      authorUsername: username,
      authorHandle: host ? `@${username}@${host}` : username,
      authorAvatar: (r.remoteAvatar as string | null) ?? null,
      authorProfileUrl: iri,
      authorIri: iri || null,
    };
  }
  const username = (r.localUsername as string | null) ?? "deleted";
  return {
    id: r.id as number,
    topicId: r.topicId as number,
    parentId: r.parentId as number | null,
    body: r.body as string,
    votesUp: r.votesUp as number,
    votesDown: r.votesDown as number,
    createdAt: r.createdAt as Date,
    hidden: Boolean(r.hidden),
    authorId: (r.authorId as number | null) ?? null,
    remoteActorId: null,
    isRemoteAuthor: false,
    authorName: (r.localFullName as string | null) ?? username,
    authorUsername: username,
    authorHandle: username,
    authorAvatar: (r.localAvatar as string | null) ?? null,
    authorProfileUrl: `/users/${username}/`,
    authorIri: null,
  };
}

/** Drop the auto-added reply mention prefix from federated (remote) comments. */
function cleanRemoteBody(c: TopicComment): TopicComment {
  return c.isRemoteAuthor ? { ...c, body: stripLeadingReplyMentions(c.body) } : c;
}

export async function getComments(topicId: number, includeHidden: boolean = false): Promise<TopicComment[]> {
  const db = getDrizzle();
  const where = includeHidden
    ? eq(comments.topicId, topicId)
    : and(eq(comments.topicId, topicId), eq(comments.hidden, false));
  const rows = await db
    .select(commentSelect)
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
    .where(where)
    .orderBy(asc(comments.createdAt));
  return rows.map((r) => cleanRemoteBody(toTopicComment(r)));
}

export async function getCommentById(commentId: number): Promise<TopicComment | undefined> {
  const db = getDrizzle();
  const rows = await db
    .select(commentSelect)
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
    .where(eq(comments.id, commentId))
    .limit(1);
  const comment = rows[0] ? toTopicComment(rows[0]) : undefined;
  return comment ? cleanRemoteBody(comment) : undefined;
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
  body: string;
  apUrl?: string | null;
  authorId?: number | null;
  remoteActorId?: number | null;
}): Promise<number> {
  const authorId = opts.authorId ?? null;
  const remoteActorId = opts.remoteActorId ?? null;
  if ((authorId ? 1 : 0) + (remoteActorId ? 1 : 0) !== 1) return 0;
  const db = getDrizzle();
  const ids = await db
    .insert(comments)
    .values({
      topicId: opts.topicId,
      parentId: opts.parentId,
      authorId,
      remoteActorId,
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
  if (id) await notifyComment(id);
  if (id && !opts.apUrl) void notifyCommentCreated(id, authorId!).catch(() => console.error("Не удалось отправить комментарий в федерацию"));
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

export async function updateComment(commentId: number, body: string): Promise<boolean> {
  const db = getDrizzle();
  const rows = await db
    .update(comments)
    .set({ body, editedAt: new Date() })
    .where(and(eq(comments.id, commentId), isNull(comments.remoteActorId)))
    .returning({ id: comments.id });
  return rows.length > 0;
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
  if (author[0] && !author[0].apUrl) void notifyCommentDeleted(commentId, topicId, author[0].authorId!);
}