import { and, eq } from "drizzle-orm";
import { getDrizzle, type Db } from "../core/db";
import { votes, topics, comments } from "../core/schema";
import type { SessionUser } from "../core/middleware";
import { createNotification } from "../notifications/service";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type VoteValue = 1 | -1;

export type VoteResult =
  | { ok: true; up: number; down: number }
  | { ok: false; error: string };

async function notifyLike(
  voterUserId: number,
  entityType: "topic" | "comment",
  entityId: number,
): Promise<void> {
  const db = getDrizzle();
  const row = entityType === "topic"
    ? db.select({ authorId: topics.authorId }).from(topics)
      .where(and(eq(topics.id, entityId), eq(topics.hidden, false))).get()
    : db.select({ authorId: comments.authorId }).from(comments)
      .innerJoin(topics, eq(topics.id, comments.topicId))
      .where(and(eq(comments.id, entityId), eq(comments.hidden, false), eq(topics.hidden, false))).get();
  if (!row || row.authorId == null || row.authorId === voterUserId) return;
  await createNotification({
    userId: row.authorId,
    actorId: voterUserId,
    type: "like",
    topicId: entityType === "topic" ? entityId : undefined,
    commentId: entityType === "comment" ? entityId : undefined,
    eventKey: `like:${entityType}:${entityId}`,
  });
}

function applyVote(
  tx: Transaction,
  user: SessionUser,
  entityType: "topic" | "comment",
  entityId: number,
  value: VoteValue,
  votesUp: number,
  votesDown: number,
): VoteResult {
  const scope = and(
    eq(votes.userId, user.id),
    eq(votes.entityType, entityType),
    eq(votes.entityId, entityId),
  );
  const oldValue = tx.select({ value: votes.value }).from(votes).where(scope).get()?.value;
  // Повторный голос в ту же сторону отклоняется.
  if (oldValue === value) {
    return { ok: false, error: "Вы уже проголосовали за этот топик." };
  }

  if (oldValue === undefined) {
    tx.insert(votes).values({ userId: user.id, entityType, entityId, value }).run();
  } else {
    tx.update(votes).set({ value }).where(scope).run();
  }

  const upDelta = value === 1 ? 1 : oldValue === 1 ? -1 : 0;
  const downDelta = value === -1 ? 1 : oldValue === -1 ? -1 : 0;
  const up = Math.max(0, votesUp + upDelta);
  const down = Math.max(0, votesDown + downDelta);

  if (entityType === "topic") {
    tx.update(topics).set({ votesUp: up, votesDown: down }).where(eq(topics.id, entityId)).run();
  } else {
    tx.update(comments).set({ votesUp: up, votesDown: down }).where(eq(comments.id, entityId)).run();
  }

  return { ok: true, up, down };
}

/**
 * Единственная бизнес-операция голосования для HTML-форм и JSON API.
 * Голос и счётчики применяются атомарно в одной транзакции.
 */
export async function castVote(
  user: SessionUser,
  entityType: "topic" | "comment",
  entityId: number,
  value: VoteValue,
): Promise<VoteResult> {
  if (user.banned) return { ok: false, error: "Аккаунт заблокирован" };

  const result = getDrizzle().transaction((tx): VoteResult => {
    if (entityType === "topic") {
      const target = tx.select({ hidden: topics.hidden, votesUp: topics.votesUp, votesDown: topics.votesDown })
        .from(topics).where(eq(topics.id, entityId)).get();
      if (!target || target.hidden) return { ok: false, error: "Топик не найден" };
      return applyVote(tx, user, "topic", entityId, value, target.votesUp, target.votesDown);
    }

    const target = tx.select({ hidden: comments.hidden, topicId: comments.topicId, votesUp: comments.votesUp, votesDown: comments.votesDown })
      .from(comments).where(eq(comments.id, entityId)).get();
    if (!target || target.hidden) return { ok: false, error: "Комментарий не найден" };
    const parentTopic = tx.select({ hidden: topics.hidden })
      .from(topics).where(eq(topics.id, target.topicId)).get();
    if (!parentTopic || parentTopic.hidden) return { ok: false, error: "Комментарий не найден" };
    return applyVote(tx, user, "comment", entityId, value, target.votesUp, target.votesDown);
  });
  if (result.ok && value === 1) await notifyLike(user.id, entityType, entityId);
  return result;
}
