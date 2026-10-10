import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { UserContext } from "../core/middleware";
import { isStaff, requireAuth } from "../core/middleware";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import { topics } from "../core/schema";
import { renderTelegramCheckHtml, renderTelegramSettingsHtml } from "./components";
import {
  deleteWebhook,
  getChat,
  getMe,
  getWebhookInfo,
  setWebhook,
  type TgUpdate,
} from "./client";
import { createTelegramThreadForTopic, unlinkTelegramThread } from "./mirror";
import { handleTelegramUpdate } from "./receive";
import { listThreads } from "./service";
import {
  newWebhookSecret,
  readTelegramSettings,
  telegramWebhookUrl,
  writeTelegramSettings,
  type TgSettingKey,
} from "./settings";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

/** Апдейты приходят только с серверов Telegram; лимит — от случайных штормов. */
const MAX_TRACKED_IPS = 5000;
const webhookHits = new Map<string, { time: number; count: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (webhookHits.size >= MAX_TRACKED_IPS) {
    for (const [key, value] of webhookHits) {
      if (now - value.time > 60_000) webhookHits.delete(key);
    }
    if (webhookHits.size >= MAX_TRACKED_IPS) webhookHits.clear();
  }
  const entry = webhookHits.get(ip);
  if (!entry || now - entry.time > 60_000) {
    webhookHits.set(ip, { time: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 120;
}

function clientIp(c: any): string {
  return c.req.header("x-real-ip") || c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function secretMatches(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/* ── Вебхук ── */

app.post("/telegram/webhook/:token", async (c) => {
  const settings = await readTelegramSettings();
  if (!settings.configured || !settings.webhookSecret) {
    return c.json({ ok: false, error: "Вебхук не настроен" }, 503);
  }
  if (rateLimited(clientIp(c))) return c.json({ ok: false, error: "too many requests" }, 429);
  if (!secretMatches(c.req.param("token"), settings.webhookSecret)) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }

  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }
  if (!update || typeof update.update_id !== "number") {
    return c.json({ ok: false, error: "invalid update" }, 400);
  }
  if (update.message?.chat?.id !== undefined && String(update.message.chat.id) !== settings.chatId.trim()) {
    return c.json({ ok: false, error: "unknown chat" }, 403);
  }

  await handleTelegramUpdate(update);
  return c.body("", 200, { "Content-Type": "application/json" });
});

/* ── Настройки (только редакторам) ── */

app.use("/settings/telegram", requireAuth, async (c, next) => {
  if (!isStaff(c.get("user"))) return c.text("Доступ запрещён", 403);
  await next();
});

app.use("/settings/telegram", async (c, next) => {
  // Формы настроек шлёт только сам сайт.
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    const referer = c.req.header("Referer");
    const sameOrigin = (() => {
      try {
        const publicOrigin = new URL(config.baseUrl).origin;
        return origin !== undefined ? origin === publicOrigin : referer !== undefined && new URL(referer).origin === publicOrigin;
      } catch {
        return false;
      }
    })();
    if (!sameOrigin) return c.text("Запрос отклонён. Отправьте форму со страницы настроек этого сайта.", 403);
  }
  await next();
});

async function renderSettings(c: any, opts: { message?: string; error?: string } = {}) {
  const settings = await readTelegramSettings();
  const threads = await listThreads(50);
  return c.html(
    await renderTelegramSettingsHtml(c.get("user") ?? null, {
      tokenMask: maskToken(settings.botToken),
      hasToken: Boolean(settings.botToken),
      chatId: settings.chatId,
      mirrorNewTopics: settings.mirrorNewTopics,
      webhookUrl: settings.webhookSecret ? telegramWebhookUrl(settings.webhookSecret) : "",
      configured: settings.configured,
      threads,
      message: opts.message,
      error: opts.error,
    }),
  );
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 12) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function str(form: Record<string, unknown>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value.trim() : "";
}

app.get("/settings/telegram", (c) => renderSettings(c));

app.post("/settings/telegram", async (c) => {
  const form = await c.req.parseBody();
  const patch: Partial<Record<TgSettingKey, string>> = {};

  const token = str(form, "bot_token");
  if (token) patch.bot_token = token;
  patch.chat_id = str(form, "chat_id");
  patch.mirror_new_topics = str(form, "mirror_new_topics") === "1" ? "1" : "0";

  const current = await readTelegramSettings();
  if (!current.webhookSecret) patch.webhook_secret = newWebhookSecret();

  try {
    await writeTelegramSettings(patch);
  } catch (error) {
    console.error("[tg] не удалось сохранить настройки:", error);
    return renderSettings(c, { error: "Не удалось сохранить настройки." });
  }
  return renderSettings(c, { message: "Настройки сохранены." });
});

app.post("/settings/telegram/webhook", async (c) => {
  const form = await c.req.parseBody();
  const action = str(form, "action");
  const settings = await readTelegramSettings();
  if (!settings.botToken) return renderSettings(c, { error: "Сначала укажите токен бота." });
  if (action !== "delete" && !settings.webhookSecret) {
    await writeTelegramSettings({ webhook_secret: newWebhookSecret() });
  }

  try {
    if (action === "delete") {
      await deleteWebhook(settings.botToken);
      return renderSettings(c, { message: "Вебхук удалён." });
    }
    const fresh = await readTelegramSettings();
    const secret = fresh.webhookSecret;
    await setWebhook(settings.botToken, telegramWebhookUrl(secret), secret, ["message", "edited_message"]);
    return renderSettings(c, { message: `Вебхук установлен: ${telegramWebhookUrl(secret)}` });
  } catch (error) {
    const reason = (error as Error)?.message ?? String(error);
    console.error("[tg] не удалось обновить вебхук:", reason);
    return renderSettings(c, { error: `Ошибка вебхука: ${reason}` });
  }
});

app.post("/settings/telegram/test", async (c) => {
  const settings = await readTelegramSettings();
  if (!settings.botToken) return renderSettings(c, { error: "Сначала укажите токен бота." });
  const lines: string[] = [];
  let ok = false;
  try {
    const me = await getMe(settings.botToken);
    lines.push(`Бот: @${me.username ?? "без имени"} (id ${me.id})`);
    ok = true;
  } catch (error) {
    lines.push(`Бот недоступен: ${(error as Error)?.message ?? error}`);
  }
  if (settings.chatId) {
    try {
      const chat = await getChat(settings.botToken, settings.chatId);
      lines.push(`Чат: ${chat.title ?? chat.id} (id ${chat.id})`);
      lines.push(`Топики ${chat.is_forum ? "включены" : "ВЫКЛЮЧЕНЫ — включите их в настройках группы"}`);
      if (chat.username) await writeTelegramSettings({ chat_username: chat.username });
    } catch (error) {
      lines.push(`Чат недоступен: ${(error as Error)?.message ?? error}`);
      ok = false;
    }
  } else {
    lines.push("ID чата не указан.");
    ok = false;
  }
  try {
    const info = await getWebhookInfo(settings.botToken);
    const url = String((info as { url?: string }).url ?? "");
    lines.push(url ? `Вебхук: ${url}` : "Вебхук не установлен.");
  } catch {
    /* не критично для проверки связи */
  }

  const html = await renderTelegramCheckHtml(c.get("user") ?? null, { ok, lines });
  return c.html(html);
});

/* ── Управление темами со страницы топика ── */

/** Минимум данных о топике: страница топика и так увеличивает счётчик просмотров. */
async function topicForActions(topicId: number): Promise<{ id: number; slug: string; title: string; authorId: number } | null> {
  const rows = await getDrizzle()
    .select({ id: topics.id, slug: topics.slug, title: topics.title, authorId: topics.authorId })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  return rows[0] ?? null;
}

app.post("/topics/:id/telegram", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const topicId = Number(c.req.param("id")) || 0;
  const topic = await topicForActions(topicId);
  if (!topic) return c.notFound();
  if (topic.authorId !== user.id && !isStaff(user)) return c.text("Forbidden", 403);
  const result = await createTelegramThreadForTopic(topicId);
  const q = result.ok ? "?tg=ok" : `?tg=error&reason=${encodeURIComponent(result.error ?? "error")}`;
  return c.redirect(`/topics/${topicId}/${topic.slug}${q}`);
});

app.post("/topics/:id/telegram/delete", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const topicId = Number(c.req.param("id")) || 0;
  const topic = await topicForActions(topicId);
  if (!topic) return c.notFound();
  if (topic.authorId !== user.id && !isStaff(user)) return c.text("Forbidden", 403);
  const removed = await unlinkTelegramThread(topicId);
  return c.redirect(`/topics/${topicId}/${topic.slug}${removed ? "?tg=removed" : ""}`);
});

export default app;
