import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../core/config";
import { requireAuth } from "../core/middleware";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  createOwnedMessageBot,
  deleteOwnedMessageBot,
  disableOwnedMessageBot,
  enableOwnedMessageBot,
  listOwnedMessageBots,
  MAX_OWNED_MESSAGE_BOTS,
  MessageBotManagementError,
  renameOwnedMessageBot,
  rotateOwnedMessageBotToken,
} from "./service";

const app = new Hono<{ Variables: UserContext }>({ strict: false });
type AppContext = Context<{ Variables: UserContext }>;
type PageStatus = 200 | 400 | 403 | 404 | 409;

function sameOrigin(c: AppContext): boolean {
  const origin = c.req.header("Origin");
  const referer = c.req.header("Referer");
  try {
    const publicOrigin = new URL(config.baseUrl).origin;
    return origin !== undefined
      ? origin === publicOrigin
      : referer !== undefined && new URL(referer).origin === publicOrigin;
  } catch {
    return false;
  }
}

app.use("/settings/bots", requireAuth, async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  if (c.req.method === "POST" && !sameOrigin(c)) {
    return c.text("Запрос отклонён. Отправьте форму со страницы настроек этого сайта.", 403);
  }
  await next();
});

function formBotId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new MessageBotManagementError(400, "Некорректный идентификатор бота.");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new MessageBotManagementError(400, "Некорректный идентификатор бота.");
  return id;
}

async function renderSettings(
  c: AppContext,
  options: {
    token?: { username: string; value: string };
    error?: string;
    message?: string;
    username?: string;
    fullName?: string;
    status?: PageStatus;
  } = {},
) {
  const user = c.get("user")!;
  const bots = listOwnedMessageBots(user.id);
  const html = await layoutWithSidebar({
    title: `Мои боты — ${config.siteName}`,
    user,
    children: (
      <div class="text12" id="bot_settings">
        <style>{`
          #bot_settings .bot-card { margin:12px 0;padding:12px;border:1px solid #ccc;background:#fff; }
          #bot_settings .bot-card-disabled { opacity:.72;background:#f3f3f3; }
          #bot_settings .bot-actions form { display:inline-block;margin:5px 8px 0 0;vertical-align:bottom; }
          #bot_settings .bot-token { box-sizing:border-box;width:100%;font-family:monospace; }
          #bot_settings .bot-name-input { width:240px;max-width:100%; }
        `}</style>
        <h1 class="h_page_header">Мои боты</h1>
        <p><a href={`/users/${user.username}/settings`}>Вернуться в настройки профиля</a></p>
        <p><a href="/docs/bot-api">Документация Musorgram Bot API</a></p>
        {options.error ? <div class="div_block" style="color:#990000;background:#ffeeee" role="alert">{options.error}</div> : null}
        {options.message ? <div class="div_block" role="status">{options.message}</div> : null}

        {options.token ? (
          <div class="div_block" role="status">
            <h2>Токен @{options.token.username}</h2>
            <p><strong>Скопируйте токен сейчас: повторно он показан не будет.</strong></p>
            <textarea class="bot-token" readonly rows={3} autocomplete="off" spellcheck={false}>{options.token.value}</textarea>
            <p>Для GramIO задайте:</p>
            <textarea class="bot-token" readonly rows={3} autocomplete="off" spellcheck={false}>{`BOT_TOKEN=${options.token.value}\nBOT_API_BASE_URL=${config.baseUrl}/telegram-bot-api/bot`}</textarea>
            <p class="dark">Сервер хранит только SHA-256-хеш. Если токен потерян или раскрыт, замените его.</p>
          </div>
        ) : null}

        <div class="div_block">
          <h2>Создать бота</h2>
          <p>Можно создать до {MAX_OWNED_MESSAGE_BOTS} ботов. Логин должен оканчиваться на <code>bot</code> и после создания не меняется.</p>
          <form method="post" action="/settings/bots">
            <input type="hidden" name="action" value="create" />
            <p>
              <label for="bot_username">Логин:</label><br />
              <input id="bot_username" class="input_auth" type="text" name="username" minlength={3} maxlength={32} pattern="[A-Za-z0-9_]*[Bb][Oo][Tt]" value={options.username ?? ""} placeholder="example_bot" required />
            </p>
            <p>
              <label for="bot_full_name">Отображаемое имя:</label><br />
              <input id="bot_full_name" class="input_auth" type="text" name="full_name" maxlength={80} value={options.fullName ?? ""} placeholder="Мой бот" required />
            </p>
            <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer" disabled={bots.length >= MAX_OWNED_MESSAGE_BOTS}>Создать бота</button>
          </form>
        </div>

        <div class="div_block">
          <h2>Созданные боты ({bots.length}/{MAX_OWNED_MESSAGE_BOTS})</h2>
          {bots.length === 0 ? <p>У вас пока нет ботов.</p> : bots.map((bot) => (
            <div class={`bot-card${bot.disabledAt ? " bot-card-disabled" : ""}`} key={bot.userId}>
              <h3 style="margin-top:0"><a href={`/users/${encodeURIComponent(bot.username)}`}>@{bot.username}</a></h3>
              <p>
                {bot.disabledAt
                  ? `Отключён ${bot.disabledAt.toLocaleString("ru-RU")}. Токен отозван, новые сообщения не доставляются.`
                  : "Включён. Может получать сообщения после добавления в диалог или группу."}
              </p>
              <div class="bot-actions">
                <form method="post" action="/settings/bots">
                  <input type="hidden" name="action" value="rename" />
                  <input type="hidden" name="bot_id" value={bot.userId} />
                  <label>Имя: <input class="bot-name-input" type="text" name="full_name" maxlength={80} value={bot.fullName ?? bot.username} required /></label>{" "}
                  <button type="submit">Сохранить имя</button>
                </form>
                {bot.disabledAt ? (
                  <>
                    <form method="post" action="/settings/bots">
                      <input type="hidden" name="action" value="enable" />
                      <input type="hidden" name="bot_id" value={bot.userId} />
                      <button type="submit" class="blue">Включить и создать токен</button>
                    </form>
                    <form method="post" action="/settings/bots" onsubmit="return confirm('Удалить бота навсегда? Будут удалены его личные диалоги и членство в группах. Отменить это действие нельзя.')">
                      <input type="hidden" name="action" value="delete" />
                      <input type="hidden" name="bot_id" value={bot.userId} />
                      <button type="submit">Удалить навсегда</button>
                    </form>
                  </>
                ) : (
                  <>
                    <form method="post" action="/settings/bots" onsubmit="return confirm('Старый токен сразу перестанет работать. Продолжить?')">
                      <input type="hidden" name="action" value="rotate" />
                      <input type="hidden" name="bot_id" value={bot.userId} />
                      <button type="submit">Заменить токен</button>
                    </form>
                    <form method="post" action="/settings/bots" onsubmit="return confirm('Отключить бота и отозвать его токен? История сообщений сохранится.')">
                      <input type="hidden" name="action" value="disable" />
                      <input type="hidden" name="bot_id" value={bot.userId} />
                      <button type="submit">Отключить</button>
                    </form>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`, options.status ?? 200);
}

app.get("/settings/bots", (c) => renderSettings(c));

app.post("/settings/bots", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.parseBody();
  const action = typeof body.action === "string" ? body.action : "";
  const username = typeof body.username === "string" ? body.username : "";
  const fullName = typeof body.full_name === "string" ? body.full_name : "";
  try {
    if (action === "create") {
      const bot = await createOwnedMessageBot(user.id, username, fullName);
      return renderSettings(c, { token: { username: bot.username, value: bot.token } });
    }
    const botUserId = formBotId(body.bot_id);
    if (action === "rotate") {
      const bot = rotateOwnedMessageBotToken(user.id, botUserId);
      return renderSettings(c, { token: { username: bot.username, value: bot.token } });
    }
    if (action === "enable") {
      const bot = enableOwnedMessageBot(user.id, botUserId);
      return renderSettings(c, { token: { username: bot.username, value: bot.token } });
    }
    if (action === "disable") {
      disableOwnedMessageBot(user.id, botUserId);
      return c.redirect("/settings/bots", 303);
    }
    if (action === "delete") {
      deleteOwnedMessageBot(user.id, botUserId);
      return renderSettings(c, { message: "Бот и связанные с ним личные диалоги удалены." });
    }
    if (action === "rename") {
      renameOwnedMessageBot(user.id, botUserId, fullName);
      return renderSettings(c, { message: "Имя бота сохранено." });
    }
    throw new MessageBotManagementError(400, "Неизвестное действие.");
  } catch (error) {
    if (error instanceof MessageBotManagementError) {
      return renderSettings(c, {
        error: error.message,
        username,
        fullName,
        status: error.status,
      });
    }
    console.error("[bot-api] Ошибка управления ботом:", error);
    return renderSettings(c, { error: "Внутренняя ошибка сервера.", status: 400 });
  }
});

app.get("/docs/bot-api", async (c) => {
  const markdown = await Bun.file("BOT_API.md").text();
  const html = await layoutWithSidebar({
    title: `Musorgram Bot API — ${config.siteName}`,
    user: c.get("user") ?? null,
    children: (
      <article class="text12">
        <h1 class="h_page_header">Musorgram Bot API</h1>
        <p><a href="/settings/bots">Управление моими ботами</a></p>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #ccc;padding:12px">{markdown}</pre>
      </article>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

export default app;
