import { randomBytes } from "node:crypto";
import { getDrizzle } from "../core/db";
import { tgSettings } from "../core/schema";
import { config } from "../core/config";

/** Ключи настроек интеграции, которые хранятся в базе. */
export const TG_SETTING_KEYS = ["bot_token", "chat_id", "webhook_secret", "mirror_new_topics", "chat_username"] as const;
export type TgSettingKey = (typeof TG_SETTING_KEYS)[number];

export type TelegramSettings = {
  botToken: string;
  chatId: string;
  /** Секрет вебхука: Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string;
  /** Создавать тему чата под каждый новый топик сайта. */
  mirrorNewTopics: boolean;
  /** Публичное имя чата (если группа публичная) — для ссылки на тему. */
  chatUsername: string | null;
  /** Токен и чат заданы — интеграция рабочая. */
  configured: boolean;
};

export async function readTelegramSettings(): Promise<TelegramSettings> {
  const rows = await getDrizzle()
    .select({ key: tgSettings.key, value: tgSettings.value })
    .from(tgSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const botToken = (map.get("bot_token") ?? "").trim() || config.telegram.botToken.trim();
  const chatId = (map.get("chat_id") ?? "").trim() || config.telegram.chatId.trim();
  const mirror = map.get("mirror_new_topics");
  return {
    botToken,
    chatId,
    webhookSecret: (map.get("webhook_secret") ?? "").trim(),
    // По умолчанию новые топики дублируются: так решили при настройке интеграции.
    mirrorNewTopics: mirror === undefined ? true : mirror !== "0",
    chatUsername: (map.get("chat_username") ?? "").trim() || null,
    configured: Boolean(botToken && chatId),
  };
}

export async function writeTelegramSettings(patch: Partial<Record<TgSettingKey, string>>): Promise<void> {
  const db = getDrizzle();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(tgSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: tgSettings.key, set: { value, updatedAt: new Date() } });
  }
}

/** Секрет вебхука: буквы, цифры, `_` и `-` — Telegram других символов не принимает. */
export function newWebhookSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function telegramWebhookUrl(secret: string): string {
  return `${config.baseUrl}/telegram/webhook/${secret}`;
}
