import { Hono } from "hono";
import type { UserContext } from "../core/middleware";
import { requireAuth } from "../core/middleware";
import { renderPage } from "../layout/layout";
import { NotificationList } from "./components";
import { listNotifications, markRead } from "./service";

const app = new Hono<{ Variables: UserContext }>({ strict: false });
app.get("/notifications", requireAuth, async (c) => {
  const user = c.get("user")!;
  const page = Math.max(1, Math.min(100000, Math.trunc(Number(c.req.query("page")) || 1)));
  const items = await listNotifications(user.id, page);
  return c.html(`<!DOCTYPE html>${await renderPage({ title: "Уведомления", user, children: <NotificationList items={items} page={page} /> })}`);
});
app.post("/notifications/read", requireAuth, async (c) => {
  const body = await c.req.parseBody();
  const id = body.id === undefined ? undefined : Number(body.id);
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) return c.text("Неверное уведомление", 400);
  await markRead(c.get("user")!.id, id);
  return c.redirect("/notifications");
});
export default app;
