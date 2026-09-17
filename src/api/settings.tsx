import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { and, count, eq, gt } from "drizzle-orm";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import type { UserContext } from "../core/middleware";
import { apiTokens, notifications, sessions, users } from "../core/schema";
import { layoutWithSidebar } from "../layout/layout";
import { revokeApiToken, rotateApiToken } from "./tokens";

const app = new Hono<{ Variables: UserContext }>({ strict: false });
type AppContext = Context<{ Variables: UserContext }>;

app.use("/settings/api", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) return c.redirect("/login");
  const db = getDrizzle();
  const user = db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    avatarUrl: users.avatarUrl,
    banned: users.banned,
  }).from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, new Date()), eq(users.banned, false))).get();
  if (!user) return c.redirect("/login");
  const unread = db.select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false))).get();
  c.set("user", { ...user, unreadCount: unread?.n ?? 0 });
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");
    let sameOrigin = false;
    try {
      const publicOrigin = new URL(config.baseUrl).origin;
      sameOrigin = origin !== undefined
        ? origin === publicOrigin
        : referer !== undefined && new URL(referer).origin === publicOrigin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return c.text("Запрос отклонён. Отправьте форму со страницы настроек этого сайта.", 403);
  }
  await next();
});

async function renderSettings(c: AppContext, token?: string) {
  const user = c.get("user")!;
  const active = getDrizzle().select({ userId: apiTokens.userId }).from(apiTokens)
    .where(eq(apiTokens.userId, user.id)).get() !== undefined;
  const html = await layoutWithSidebar({
    title: `Публичный API — ${config.siteName}`,
    user,
    children: (
      <div class="text12" id="api_settings">
        <h1 class="h_page_header">Публичный API</h1>
        <p><a href={`/users/${user.username}/settings`}>Вернуться в настройки профиля</a></p>
        <div class="div_block">
          <h2>Токен доступа</h2>
          <p>Токен позволяет вашим программам работать от вашего имени через JSON API. Действуют те же ограничения и права, что и на сайте.</p>
          <p>У учётной записи может быть только один токен. Он не имеет срока действия и работает после выхода из аккаунта. Не передавайте его другим людям и не публикуйте в коде.</p>
          {token ? (
            <div role="status">
              <p><strong>Токен создан. Скопируйте его сейчас: он показан только один раз.</strong></p>
              <p><label for="api_token">Ваш токен:</label></p>
              <textarea id="api_token" class="input_auth" readonly rows={3} autocomplete="off" spellcheck={false} style="box-sizing:border-box;width:100%;font-family:monospace">{token}</textarea>
              <p>Сервер хранит только хеш токена. Восстановить его нельзя; если потеряете токен, создайте новый.</p>
            </div>
          ) : null}
          <p>{active ? "Токен активен. При создании нового старый сразу перестанет работать." : "Активного токена нет."}</p>
          <form method="post" action="/settings/api">
            <input type="hidden" name="action" value="rotate" />
            <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">{active ? "Заменить токен" : "Создать токен"}</button>
          </form>
          {active ? (
            <form method="post" action="/settings/api" style="margin-top:10px">
              <input type="hidden" name="action" value="revoke" />
              <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">Отозвать токен</button>
              <p class="dark">Отзыв сразу отключит доступ по этому токену. Позже можно создать новый.</p>
            </form>
          ) : null}
        </div>
        <div class="div_block">
          <h2>Как использовать</h2>
          <p>Отправляйте токен только в заголовке <code>Authorization: Bearer ВАШ_ТОКЕН</code> по HTTPS. Не добавляйте его в адрес запроса.</p>
          <p>Для проверки доступа выполните <code>GET /api/me</code>. Настройки токена доступны только после входа на сайт, не через API.</p>
        </div>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/settings/api", (c) => renderSettings(c));

app.post("/settings/api", async (c) => {
  const body = await c.req.parseBody();
  const user = c.get("user")!;
  if (body.action === "rotate") {
    const token = await rotateApiToken(user.id);
    return renderSettings(c, token);
  }
  if (body.action === "revoke") {
    await revokeApiToken(user.id);
    return c.redirect("/settings/api", 303);
  }
  return c.text("Неизвестное действие.", 400);
});

export default app;
