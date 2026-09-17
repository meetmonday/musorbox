import { Hono } from "hono";
import type { UserContext } from "../core/middleware";
import { isStaff, requireAuth } from "../core/middleware";
import { renderPage } from "../layout/layout";
import { ModerationPage } from "./components";
import { banUser, hideComment, moderationOverview, setTopicHidden, unbanUser } from "./service";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

app.use("/moderation/*", requireAuth, async (c, next) => {
  if (!isStaff(c.get("user"))) return c.text("Доступ запрещён", 403);
  await next();
});

function optionsFrom(params: URLSearchParams) {
  const rawSection = params.get("section");
  const section = rawSection === "comments" || rawSection === "users" || rawSection === "log" ? rawSection : "topics";
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const filter = params.get("filter") === "restricted" ? "restricted" as const : "all" as const;
  return { section, page, query: (params.get("q") ?? "").trim().slice(0, 100), filter } as const;
}

app.get("/moderation", requireAuth, async (c) => {
  const user = c.get("user")!;
  if (!isStaff(user)) return c.text("Доступ запрещён", 403);
  const data = await moderationOverview(optionsFrom(new URL(c.req.url).searchParams));
  const message = c.req.query("done") === "1" ? "Изменения сохранены." : undefined;
  const error = c.req.query("error") === "1" ? "Действие не выполнено: запись уже изменена, удалена или недоступна для вашей роли." : undefined;
  return c.html(`<!DOCTYPE html>${await renderPage({ title: "Модерация", user, children: <ModerationPage data={data} user={user} message={message} error={error} /> })}`);
});

app.post("/moderation/:entity/:id/:action", async (c) => {
  const user = c.get("user")!;
  const entity = c.req.param("entity");
  const action = c.req.param("action");
  if (entity !== "topics" && entity !== "comments" && entity !== "users") return c.notFound();
  if (entity === "users" ? action !== "ban" && action !== "unban" : action !== "hide" && action !== "show") return c.notFound();
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();
  const form = await c.req.parseBody();
  const reason = typeof form.reason === "string" ? form.reason.trim().slice(0, 200) : "";
  const normalizedReason = reason || (action === "hide" || action === "ban" ? "нарушение правил" : "восстановлен");
  const ok = entity === "topics" ? await setTopicHidden(user.id, id, action === "hide", normalizedReason)
    : entity === "comments" ? await hideComment(user.id, id, action === "hide", normalizedReason)
    : action === "ban" ? await banUser(user.id, id, normalizedReason) : await unbanUser(user.id, id, normalizedReason);
  const destination = new URL("/moderation", c.req.url);
  destination.searchParams.set("section", entity);
  if (typeof form.returnTo === "string") {
    const requested = new URL(form.returnTo, c.req.url);
    if (requested.origin === destination.origin && requested.pathname === "/moderation") {
      const options = optionsFrom(requested.searchParams);
      destination.search = new URLSearchParams({ section: options.section, page: String(options.page), q: options.query, filter: options.filter }).toString();
    }
  }
  destination.searchParams.set(ok ? "done" : "error", "1");
  return c.redirect(`${destination.pathname}${destination.search}`, 303);
});

export default app;
