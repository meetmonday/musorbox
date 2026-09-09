import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { getDb, getDrizzle } from "./core/db";
import { config } from "./core/config";
import { sessionMiddleware } from "./core/middleware";
import { renderPage, layoutWithSidebar } from "./layout/layout";
import type { UserContext } from "./core/middleware";

type AppEnv = {
  Variables: UserContext;
};

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", sessionMiddleware);
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));
app.use("/avatars/*", serveStatic({ root: "./public" }));

app.get("/", (c) => {
  const user = c.get("user") ?? null;
  const html = layoutWithSidebar({
    title: `Главная — ${config.siteName}`,
    user,
    currentSection: "news",
    sidebar: (
      <div>
        <div class="div_panel_view_block">
          <div class="div_panel_caption">Свежие обсуждения</div>
          <div class="div_panel_view">Скоро здесь будут обсуждения</div>
        </div>
      </div>
    ),
    children: (
      <div>
        <h1 class="h_page_header">Новости</h1>
        <div class="a_trashcut">
          <a href="/new_topic/">Добавить топик</a>
        </div>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.get("/login", (c) => {
  const user = c.get("user") ?? null;
  const html = renderPage({
    title: `Вход — ${config.siteName}`,
    user,
    children: (
      <div style="padding:40px">
        <h1 class="h_page_header">Вход на сайт</h1>
        <form method="post" action="/login" id="frm_auth">
          <table>
            <tr>
              <td>Логин:</td>
              <td><input type="text" name="username" class="input_auth" /></td>
            </tr>
            <tr>
              <td>Пароль:</td>
              <td><input type="password" name="password" class="input_auth" /></td>
            </tr>
            <tr>
              <td colspan={2}><button type="submit">Войти</button></td>
            </tr>
          </table>
        </form>
        <p style="margin-top:20px">
          Нет аккаунта? <a href="/register">Зарегистрироваться</a>
        </p>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.get("/register", (c) => {
  const user = c.get("user") ?? null;
  const html = renderPage({
    title: `Регистрация — ${config.siteName}`,
    user,
    children: (
      <div style="padding:40px">
        <h1 class="h_page_header">Регистрация</h1>
        <form method="post" action="/register" id="frm_auth">
          <table>
            <tr>
              <td>Логин:</td>
              <td><input type="text" name="username" /></td>
            </tr>
            <tr>
              <td>Пароль:</td>
              <td><input type="password" name="password" /></td>
            </tr>
            <tr>
              <td colspan={2}><button type="submit">Зарегистрироваться</button></td>
            </tr>
          </table>
        </form>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.post("/login", async (c) => c.redirect("/"));
app.post("/register", async (c) => c.redirect("/"));
app.get("/logout", (c) => c.redirect("/"));

app.all("*", (c) => c.text("Not found", 404));

getDb();
console.log(`[trashbox] DB initialized at ${config.dbPath}`);

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`[trashbox] serving on http://localhost:${config.port}`);