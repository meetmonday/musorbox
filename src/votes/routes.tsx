import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { votes, topics, comments } from "../core/schema";
import type { UserContext } from "../core/middleware";
import { requireAuth } from "../core/middleware";

const app = new Hono<{ Variables: UserContext }>();

type VoteResponse = { ok: true; up: number; down: number } | { ok: false; error: string };

async function castVote(
  c: any,
  entityType: "topic" | "comment",
  entityId: number,
  value: 1 | -1,
): Promise<VoteResponse> {
  const user = c.get("user");
  const db = getDrizzle();

  const existing = await db
    .select({ value: votes.value })
    .from(votes)
    .where(
      and(eq(votes.userId, user.id), eq(votes.entityType, entityType), eq(votes.entityId, entityId)),
    );

  const oldValue = existing[0]?.value;
  if (oldValue === value) return { ok: false, error: "Вы уже проголосовали за этот топик." };

  if (oldValue === undefined) {
    await db.insert(votes).values({ userId: user.id, entityType, entityId, value });
  } else {
    await db.update(votes).set({ value }).where(
      and(eq(votes.userId, user.id), eq(votes.entityType, entityType), eq(votes.entityId, entityId)),
    );
  }

  const upDelta = value === 1 ? 1 : oldValue === 1 ? -1 : 0;
  const downDelta = value === -1 ? 1 : oldValue === -1 ? -1 : 0;

  if (entityType === "topic") {
    const topic = await db.query.topics.findFirst({ where: eq(topics.id, entityId) });
    if (!topic) return { ok: false, error: "Топик не найден" };
    const up = Math.max(0, topic.votesUp + upDelta);
    const down = Math.max(0, topic.votesDown + downDelta);
    await db.update(topics).set({ votesUp: up, votesDown: down }).where(eq(topics.id, entityId));
    return { ok: true, up, down };
  }

  const comment = await db.query.comments.findFirst({ where: eq(comments.id, entityId) });
  if (!comment) return { ok: false, error: "Комментарий не найден" };
  const up = Math.max(0, comment.votesUp + upDelta);
  const down = Math.max(0, comment.votesDown + downDelta);
  await db.update(comments).set({ votesUp: up, votesDown: down }).where(eq(comments.id, entityId));
  return { ok: true, up, down };
}

app.post("/topics/:id/vote/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const value = body.value === "down" ? -1 : 1;
  const id = Number(c.req.param("id")) || 0;
  const result = await castVote(c, "topic", id, value as 1 | -1);
  return c.json(result);
});

app.post("/comments/:id/vote/", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const value = body.value === "down" ? -1 : 1;
  const id = Number(c.req.param("id")) || 0;
  const result = await castVote(c, "comment", id, value as 1 | -1);
  return c.json(result);
});

export default app;