import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDrizzle, type Db } from "../core/db";
import { comments, modLog, notifications, sessions, topics, users } from "../core/schema";
import { config } from "../core/config";
import { notifyTopicDeleted, notifyCommentDeleted } from "../activitypub/notify";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function moderator(tx: Transaction, moderatorId: number) {
  return tx.select({ role: users.role }).from(users).where(and(
    eq(users.id, moderatorId), eq(users.banned, false), inArray(users.role, ["editor", "admin"]),
  )).get();
}

function logMod(
  tx: Transaction,
  moderatorId: number,
  action: string,
  entityType: "topic" | "comment" | "user",
  entityId: number,
  reason: string,
): number {
  return tx.insert(modLog).values({ moderatorId, action, entityType, entityId, reason })
    .returning({ id: modLog.id }).get()!.id;
}

export async function setTopicHidden(moderatorId: number, topicId: number, hidden: boolean, reason: string): Promise<boolean> {
  const topic = getDrizzle().transaction((tx) => {
    if (!moderator(tx, moderatorId)) return undefined;
    const changed = tx.update(topics).set({ hidden }).where(and(
      eq(topics.id, topicId), eq(topics.hidden, !hidden),
    )).returning({ id: topics.id, authorId: topics.authorId, slug: topics.slug }).get();
    if (!changed) return undefined;
    const logId = logMod(tx, moderatorId, hidden ? "hide_topic" : "show_topic", "topic", topicId, reason);
    if (hidden) {
      tx.insert(notifications).values({
        userId: changed.authorId,
        type: "mod",
        topicId,
        message: `Ваш топик скрыт модератором: ${reason}`,
        eventKey: `mod:${logId}`,
      }).run();
    }
    return changed;
  });
  if (!topic) return false;
  // Restoration changes local visibility only; ActivityPub Delete cannot be undone here.
  if (hidden) {
    void notifyTopicDeleted(topicId, topic.authorId, `${config.baseUrl}/topics/${topicId}/${topic.slug}`)
      .catch(() => console.error("Не удалось отправить скрытие топика в федерацию"));
  }
  return true;
}

export async function hideComment(moderatorId: number, commentId: number, hidden: boolean, reason: string): Promise<boolean> {
  const comment = getDrizzle().transaction((tx) => {
    if (!moderator(tx, moderatorId)) return undefined;
    const changed = tx.update(comments).set({ hidden }).where(and(
      eq(comments.id, commentId), eq(comments.hidden, !hidden),
    )).returning({
      id: comments.id,
      topicId: comments.topicId,
      authorId: comments.authorId,
      remoteActorId: comments.remoteActorId,
    }).get();
    if (!changed) return undefined;
    tx.update(topics).set({
      commentCount: sql`(SELECT count(*) FROM ${comments} WHERE ${comments.topicId} = ${changed.topicId} AND ${comments.hidden} = 0)`,
    }).where(eq(topics.id, changed.topicId)).run();
    const logId = logMod(tx, moderatorId, hidden ? "hide_comment" : "show_comment", "comment", commentId, reason);
    if (hidden && changed.authorId != null) {
      tx.insert(notifications).values({
        userId: changed.authorId,
        type: "mod",
        topicId: changed.topicId,
        commentId,
        message: `Ваш комментарий скрыт модератором: ${reason}`,
        eventKey: `mod:${logId}`,
      }).run();
    }
    return changed;
  });
  if (!comment) return false;
  // Never federate deletion of a remote author's comment or resurrect a restored comment.
  if (hidden && comment.remoteActorId == null && comment.authorId != null) {
    void notifyCommentDeleted(comment.id, comment.topicId, comment.authorId)
      .catch(() => console.error("Не удалось отправить скрытие комментария в федерацию"));
  }
  return true;
}

function setUserBanned(moderatorId: number, userId: number, banned: boolean, reason: string): boolean {
  if (userId === moderatorId) return false;
  return getDrizzle().transaction((tx) => {
    const actor = moderator(tx, moderatorId);
    if (!actor) return false;
    const changed = tx.update(users).set({
      banned,
      banReason: banned ? reason : null,
      bannedAt: banned ? new Date() : null,
    }).where(and(
      eq(users.id, userId),
      eq(users.banned, !banned),
      inArray(users.role, actor.role === "admin" ? ["user", "author", "editor"] : ["user", "author"]),
    )).returning({ id: users.id }).get();
    if (!changed) return false;
    const logId = logMod(tx, moderatorId, banned ? "ban" : "unban", "user", userId, reason);
    if (banned) {
      tx.delete(sessions).where(eq(sessions.userId, userId)).run();
      tx.insert(notifications).values({
        userId,
        type: "mod",
        message: `Ваш аккаунт заблокирован: ${reason}`,
        eventKey: `mod:${logId}`,
      }).run();
    }
    return true;
  });
}

export async function banUser(moderatorId: number, userId: number, reason: string): Promise<boolean> {
  return setUserBanned(moderatorId, userId, true, reason);
}

export async function unbanUser(moderatorId: number, userId: number, reason: string): Promise<boolean> {
  return setUserBanned(moderatorId, userId, false, reason);
}

export type ModerationOptions = {
  section: "topics" | "comments" | "users" | "log";
  page: number;
  query: string;
  filter: "all" | "restricted";
};

export type ModerationOverview = ModerationOptions & {
  total: number;
  pages: number;
  stats: { hiddenTopics: number; hiddenComments: number; bannedUsers: number; modActions: number };
  topics: Array<{ id: number; slug: string; title: string; author: string; hidden: boolean }>;
  comments: Array<{ id: number; topicId: number; topicSlug: string; author: string | null; body: string; hidden: boolean }>;
  users: Array<{ id: number; username: string; role: string; banned: boolean; reason: string | null }>;
  log: Array<{ id: number; action: string; entityType: string; entityId: number; reason: string; createdAt: Date; moderator: string | null }>;
};

export async function moderationOverview(options: ModerationOptions): Promise<ModerationOverview> {
  return getDrizzle().transaction((tx) => {
    const query = options.query.trim();
    const search = `%${query}%`;
    const restricted = options.filter === "restricted";
    const stats = tx.get<ModerationOverview["stats"]>(sql`SELECT
      (SELECT count(*) FROM ${topics} WHERE ${topics.hidden} = 1) AS hiddenTopics,
      (SELECT count(*) FROM ${comments} WHERE ${comments.hidden} = 1) AS hiddenComments,
      (SELECT count(*) FROM ${users} WHERE ${users.banned} = 1) AS bannedUsers,
      (SELECT count(*) FROM ${modLog}) AS modActions`)!;
    const result: ModerationOverview = {
      section: options.section,
      query,
      filter: options.filter,
      page: 1,
      pages: 1,
      total: 0,
      stats,
      topics: [],
      comments: [],
      users: [],
      log: [],
    };
    function offset(total: number): number {
      result.total = total;
      result.pages = Math.max(1, Math.ceil(total / 20));
      result.page = Math.min(result.pages, Math.max(1, Number.isFinite(options.page) ? Math.floor(options.page) : 1));
      return (result.page - 1) * 20;
    }
    switch (options.section) {
      case "topics": {
        const where = and(restricted ? eq(topics.hidden, true) : undefined, query ? like(topics.title, search) : undefined);
        const total = tx.select({ count: sql<number>`count(*)` }).from(topics)
          .innerJoin(users, eq(users.id, topics.authorId)).where(where).get()!.count;
        result.topics = tx.select({
          id: topics.id, slug: topics.slug, title: topics.title, author: users.username, hidden: topics.hidden,
        }).from(topics).innerJoin(users, eq(users.id, topics.authorId))
          .where(where).orderBy(desc(topics.id)).limit(20).offset(offset(total)).all();
        break;
      }
      case "comments": {
        const where = and(restricted ? eq(comments.hidden, true) : undefined, query ? like(comments.body, search) : undefined);
        const total = tx.select({ count: sql<number>`count(*)` }).from(comments)
          .innerJoin(topics, eq(topics.id, comments.topicId)).where(where).get()!.count;
        result.comments = tx.select({
          id: comments.id, topicId: comments.topicId, topicSlug: topics.slug,
          author: users.username, body: comments.body, hidden: comments.hidden,
        }).from(comments).leftJoin(users, eq(users.id, comments.authorId))
          .innerJoin(topics, eq(topics.id, comments.topicId))
          .where(where).orderBy(desc(comments.id)).limit(20).offset(offset(total)).all();
        break;
      }
      case "users": {
        const where = and(restricted ? eq(users.banned, true) : undefined, query ? like(users.username, search) : undefined);
        const total = tx.select({ count: sql<number>`count(*)` }).from(users).where(where).get()!.count;
        result.users = tx.select({
          id: users.id, username: users.username, role: users.role, banned: users.banned, reason: users.banReason,
        }).from(users).where(where).orderBy(desc(users.id)).limit(20).offset(offset(total)).all();
        break;
      }
      case "log": {
        const where = query ? or(like(modLog.reason, search), like(modLog.action, search), like(users.username, search)) : undefined;
        const total = tx.select({ count: sql<number>`count(*)` }).from(modLog)
          .leftJoin(users, eq(users.id, modLog.moderatorId)).where(where).get()!.count;
        result.log = tx.select({
          id: modLog.id, action: modLog.action, entityType: modLog.entityType, entityId: modLog.entityId,
          reason: modLog.reason, createdAt: modLog.createdAt, moderator: users.username,
        }).from(modLog).leftJoin(users, eq(users.id, modLog.moderatorId))
          .where(where).orderBy(desc(modLog.id)).limit(20).offset(offset(total)).all();
        break;
      }
    }
    return result;
  });
}
