import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { login, logout, register } from "./service";
import { renderPage } from "../layout/layout";

const app = new Hono<{ Variables: UserContext }>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function renderAuthPage(c: any, opts: { action: "login" | "register"; error?: string; user?: string }) {
  const user = c.get("user") ?? null;
  const isLogin = opts.action === "login";
  const title = isLogin ? `Вход на сайт — ${config.siteName}` : `Регистрация — ${config.siteName}`;
  const html = renderPage({
    title,
    user,
    children: (
      <div style="padding:40px;max-width:420px">
        <h1 class="h_page_header">{isLogin ? "Вход на сайт" : "Регистрация"}</h1>
        {opts.error ? <div style="color:#EE0000;margin-bottom:10px">{opts.error}</div> : null}
        <form method="post" action={`/${opts.action}`} id="frm_auth">
          <table class="div_auth_table">
            <tr>
              <td class="auth_label">Логин:</td>
              <td>
                <input type="text" name="username" class="input_auth" value={opts.user ?? ""} required />
              </td>
            </tr>
            <tr>
              <td class="auth_label">Пароль:</td>
              <td>
                <input type="password" name="password" class="input_auth" required />
              </td>
            </tr>
            {isLogin ? (
              <tr>
                <td />
                <td>
                  <label class="dark">
                    <input type="checkbox" name="remember" value="1" checked /> Запомнить меня
                  </label>
                </td>
              </tr>
            ) : null}
            <tr>
              <td />
              <td>
                <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
                  {isLogin ? "Войти" : "Зарегистрироваться"}
                </button>
              </td>
            </tr>
          </table>
        </form>
        <p style="margin-top:20px;font-size:1.2em">
          {isLogin ? (
            <>
              Нет аккаунта? <a href="/register" class="a_dashed">Зарегистрироваться</a>
            </>
          ) : (
            <>
              Уже есть аккаунт? <a href="/login" class="a_dashed">Войти</a>
            </>
          )}
        </p>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/login", (c) => renderAuthPage(c, { action: "login" }));

app.get("/register", (c) => renderAuthPage(c, { action: "register" }));

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  await sleep(150);
  const result = await login(username, password);
  if (!result.ok) {
    c.status(401);
    return renderAuthPage(c, { action: "login", error: result.error, user: username });
  }
  setCookie(c, "session_token", result.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: result.expiresAt,
  });
  return c.redirect("/");
});

app.post("/register", async (c) => {
  const body = await c.req.parseBody();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  const result = await register(username, password);
  if (!result.ok) {
    c.status(400);
    return renderAuthPage(c, { action: "register", error: result.error, user: username });
  }
  setCookie(c, "session_token", result.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    expires: result.expiresAt,
  });
  return c.redirect("/");
});

app.get("/logout", async (c) => {
  await logout(getCookie(c, "session_token"));
  deleteCookie(c, "session_token");
  return c.redirect("/");
});

export default app;