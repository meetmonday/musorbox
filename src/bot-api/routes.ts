import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../core/config";
import { authenticateMessageBot } from "./service";
import type { MessageBot } from "./service";
import { getBotUpdates } from "./updates";
import { BotMethodError, sendBotMediaGroup, sendBotMessage } from "./methods";
import { parseMediaGroupRequest } from "./media";

type TelegramErrorCode = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500;

const app = new Hono({ strict: false });
const activePolls = new Set<number>();
const announcedPollers = new Set<number>();
let nextRequestId = 1;

function log(message: string): void {
  console.log(`[bot-api] ${message}`);
}

function debug(message: string): void {
  if (config.botApi.debug) log(`debug: ${message}`);
}

function telegramError(c: Context, code: TelegramErrorCode, description: string) {
  return c.json({ ok: false, error_code: code, description }, code);
}

function botInfo(bot: MessageBot) {
  return {
    id: bot.userId,
    is_bot: true,
    first_name: bot.fullName || bot.username,
    username: bot.username,
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
  };
}

async function requestObject(c: Context): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")) return {};
  try {
    const value: unknown = await c.req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function integerParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

app.post("/telegram-bot-api/*", async (c) => {
  const requestId = nextRequestId++;
  const matched = /^\/telegram-bot-api\/bot([^/]+)\/([^/?]+)$/.exec(c.req.path);
  if (!matched) return telegramError(c, 404, "Not Found");
  const [, token, rawMethod] = matched;
  const method = rawMethod!.toLowerCase();
  const startedAt = Date.now();
  const bot = await authenticateMessageBot(token!);
  if (!bot) {
    console.warn(`[bot-api] #${requestId} отклонён ${rawMethod}: недействительный токен`);
    return telegramError(c, 401, "Unauthorized: invalid bot token");
  }
  debug(`#${requestId} -> ${rawMethod} bot=@${bot.username}`);

  if (method === "getme") {
    log(`#${requestId} getMe: авторизован @${bot.username} (userId=${bot.userId})`);
    return c.json({ ok: true, result: botInfo(bot) });
  }

  if (method === "getupdates") {
    if (activePolls.has(bot.userId)) {
      console.warn(`[bot-api] #${requestId} getUpdates: конфликт long polling для @${bot.username}`);
      return telegramError(c, 409, "Conflict: another getUpdates request is active");
    }
    activePolls.add(bot.userId);
    try {
      const params = await requestObject(c);
      const offset = Math.max(0, integerParam(params.offset, 0));
      const timeout = Math.max(0, Math.min(30, integerParam(params.timeout, 0)));
      if (!announcedPollers.has(bot.userId)) {
        announcedPollers.add(bot.userId);
        log(`long polling запущен для @${bot.username} (timeout=${timeout}s, offset=${offset})`);
      }
      const updates = await getBotUpdates(bot.userId, offset, timeout, c.req.raw.signal);
      if (updates.length) {
        const first = updates[0]!.update_id;
        const last = updates.at(-1)!.update_id;
        log(`#${requestId} getUpdates: @${bot.username} получил ${updates.length}, update_id=${first}..${last}`);
      } else {
        debug(`#${requestId} <- getUpdates @${bot.username}: пусто за ${Date.now() - startedAt}ms`);
      }
      return c.json({ ok: true, result: updates });
    } catch (error) {
      console.error(`[bot-api] #${requestId} getUpdates: ошибка для @${bot.username}:`, error);
      return telegramError(c, 500, "Internal Server Error");
    } finally {
      activePolls.delete(bot.userId);
    }
  }

  if (method === "sendmessage") {
    try {
      const params = await requestObject(c);
      const message = await sendBotMessage(bot, params);
      const destination = message.chat.type === "group"
        ? `group chatId=${message.chat.id}`
        : `private userId=${message.chat.id}`;
      log(`#${requestId} sendMessage: @${bot.username} -> ${destination}, messageId=${message.message_id}`);
      return c.json({ ok: true, result: message });
    } catch (error) {
      if (error instanceof BotMethodError) {
        console.warn(`[bot-api] #${requestId} sendMessage отклонён для @${bot.username}: ${error.message}`);
        return telegramError(c, error.status, error.message);
      }
      console.error(`[bot-api] #${requestId} sendMessage: ошибка для @${bot.username}:`, error);
      return telegramError(c, 500, "Internal Server Error");
    }
  }

  if (method === "sendchataction") {
    const params = await requestObject(c);
    debug(`#${requestId} sendChatAction: @${bot.username}, chatId=${String(params.chat_id ?? "?")}, action=${String(params.action ?? "?")}`);
    return c.json({ ok: true, result: true });
  }

  if (method === "sendmediagroup") {
    try {
      const input = await parseMediaGroupRequest(c);
      const result = await sendBotMediaGroup(bot, input);
      const destination = result.messages[0]!.chat;
      if (input.discardedCaptionCount > 0) {
        console.warn(
          `[bot-api] #${requestId} sendMediaGroup: @${bot.username}, `
          + `${input.discardedCaptionCount} дополнительных подписей не сохранены в общем тексте альбома`,
        );
      }
      log(
        `#${requestId} sendMediaGroup: @${bot.username} -> ${destination.type} chatId=${destination.id}, `
        + `storedMessageId=${result.storedMessageId}, photos=${result.messages.length}`,
      );
      return c.json({ ok: true, result: result.messages });
    } catch (error) {
      if (error instanceof BotMethodError) {
        console.warn(`[bot-api] #${requestId} sendMediaGroup отклонён для @${bot.username}: ${error.message}`);
        return telegramError(c, error.status, error.message);
      }
      console.error(`[bot-api] #${requestId} sendMediaGroup: ошибка для @${bot.username}:`, error);
      return telegramError(c, 500, "Internal Server Error");
    }
  }

  if (method === "deletemessage") {
    const params = await requestObject(c);
    console.warn(
      `[bot-api] #${requestId} deleteMessage: @${bot.username}, `
      + `chatId=${String(params.chat_id ?? "?")}, messageId=${String(params.message_id ?? "?")} — no-op`,
    );
    return c.json({ ok: true, result: true });
  }

  console.warn(`[bot-api] #${requestId} @${bot.username}: метод ${rawMethod} пока не поддерживается`);
  return telegramError(c, 400, `Bad Request: method ${rawMethod} is not supported`);
});

export default app;
