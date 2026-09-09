import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { renderPage } from "../layout/layout";

const app = new Hono<{ Variables: UserContext }>();

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

export default app;