import { Hono } from "hono";
import type { UserContext } from "../core/middleware";
import { requireAuth } from "../core/middleware";
import { castVote } from "./service";

const app = new Hono<{ Variables: UserContext }>({ strict: false });


app.post("/topics/:id/vote", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const value = body.value === "down" ? -1 : 1;
  const id = Number(c.req.param("id")) || 0;
  const result = await castVote(c.get("user")!, "topic", id, value);
  return c.json(result);
});

app.post("/comments/:id/vote", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const value = body.value === "down" ? -1 : 1;
  const id = Number(c.req.param("id")) || 0;
  const result = await castVote(c.get("user")!, "comment", id, value);
  return c.json(result);
});

export default app;