import { and, eq, or } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { messageBots, messageConversations, messageGroups, users } from "../core/schema";
import { sendGroupMessage } from "../messages/group-service";
import { sendPrivateMessage } from "../messages/service";
import { cleanupMessageImages, MessageImageError, prepareMessageImages } from "../messages/media";
import type { ApiMessageImage } from "../messages/media";
import type { MessageBot } from "./service";
import type { MediaGroupInput, TelegramMediaItem } from "./media";
import {
  musorgramGroupId,
  telegramBotUser,
  telegramGroupChat,
  telegramPrivateChat,
  unixTime,
} from "./telegram";
import type { TelegramMessage } from "./telegram";

export class BotMethodError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413 | 415 | 429,
    message: string,
  ) {
    super(message);
  }
}

type ResolvedBotChat =
  | {
      kind: "private";
      target: { id: number; username: string; fullName: string | null };
      chat: TelegramMessage["chat"];
    }
  | {
      kind: "group";
      group: { id: number; title: string };
      chat: TelegramMessage["chat"];
    };

function resolveBotChat(bot: MessageBot, value: unknown): ResolvedBotChat {
  const targetChatId = chatId(value);
  const db = getDrizzle();
  if (targetChatId > 0) {
    const target = db.select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      banned: users.banned,
      botUserId: messageBots.userId,
    }).from(users)
      .leftJoin(messageBots, eq(messageBots.userId, users.id))
      .where(and(eq(users.id, targetChatId), eq(users.banned, false)))
      .get();
    if (!target || target.id === bot.userId || target.botUserId !== null) {
      throw new BotMethodError(404, "Bad Request: chat not found");
    }
    const conversation = db.select({ id: messageConversations.id }).from(messageConversations)
      .where(or(
        and(eq(messageConversations.userLowId, bot.userId), eq(messageConversations.userHighId, target.id)),
        and(eq(messageConversations.userLowId, target.id), eq(messageConversations.userHighId, bot.userId)),
      )).get();
    if (!conversation) {
      throw new BotMethodError(403, "Forbidden: bot cannot initiate a private conversation");
    }
    return { kind: "private", target, chat: telegramPrivateChat(target) };
  }

  const groupId = musorgramGroupId(targetChatId);
  if (!groupId) throw new BotMethodError(404, "Bad Request: chat not found");
  const group = db.select({ id: messageGroups.id, title: messageGroups.title })
    .from(messageGroups).where(eq(messageGroups.id, groupId)).get();
  if (!group) throw new BotMethodError(404, "Bad Request: chat not found");
  return { kind: "group", group, chat: telegramGroupChat(group) };
}

function chatId(value: unknown): number {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    throw new BotMethodError(400, "Bad Request: chat_id must be an integer");
  }
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BotMethodError(400, "Bad Request: text is required");
  }
  return value;
}

function outgoingMessage(
  id: number,
  createdAt: Date,
  body: string,
  bot: MessageBot,
  chat: TelegramMessage["chat"],
  entities: unknown,
): TelegramMessage {
  return {
    message_id: id,
    date: unixTime(createdAt),
    from: telegramBotUser(bot),
    chat,
    text: body,
    entities: Array.isArray(entities) ? entities as Array<Record<string, unknown>> : undefined,
  };
}

export async function sendBotMessage(
  bot: MessageBot,
  params: Record<string, unknown>,
): Promise<TelegramMessage> {
  const destination = resolveBotChat(bot, params.chat_id);
  const body = text(params.text);
  if (destination.kind === "private") {
    const result = await sendPrivateMessage(bot.userId, destination.target.username, body);
    if (!result.ok) throw new BotMethodError(result.status, result.error);
    return outgoingMessage(
      result.message.id,
      result.message.createdAt,
      result.message.body,
      bot,
      destination.chat,
      params.entities,
    );
  }
  const result = await sendGroupMessage(bot.userId, destination.group.id, body);
  if (!result.ok) throw new BotMethodError(result.status, result.error);
  return outgoingMessage(
    result.message.id,
    result.message.createdAt,
    result.message.body,
    bot,
    destination.chat,
    params.entities,
  );
}

function mediaMessages(
  storedMessageId: number,
  createdAt: Date,
  bot: MessageBot,
  chat: TelegramMessage["chat"],
  images: ApiMessageImage[],
  items: TelegramMediaItem[],
): TelegramMessage[] {
  const mediaGroupId = `musorgram_${chat.id}_${storedMessageId}`;
  return images.map((image, index) => {
    const source = items[index]!;
    const fileId = `musorgram_image_${image.id}`;
    return {
      // Один альбом Musorgram хранится одной записью. Последние две цифры — позиция изображения.
      message_id: storedMessageId * 100 + index + 1,
      date: unixTime(createdAt),
      from: telegramBotUser(bot),
      chat,
      media_group_id: mediaGroupId,
      caption: source.caption,
      caption_entities: source.caption_entities,
      photo: [{
        file_id: fileId,
        file_unique_id: fileId,
        width: image.width,
        height: image.height,
        file_size: image.sizeBytes,
      }],
    };
  });
}

export async function sendBotMediaGroup(
  bot: MessageBot,
  input: MediaGroupInput,
): Promise<{ messages: TelegramMessage[]; storedMessageId: number }> {
  const destination = resolveBotChat(bot, input.params.chat_id);
  let images;
  try {
    images = await prepareMessageImages(input.files);
  } catch (error) {
    if (error instanceof MessageImageError) throw new BotMethodError(error.status, error.message);
    throw error;
  }
  let stored = false;
  try {
    const result = destination.kind === "private"
      ? await sendPrivateMessage(bot.userId, destination.target.username, input.caption, images)
      : await sendGroupMessage(bot.userId, destination.group.id, input.caption, images);
    if (!result.ok) throw new BotMethodError(result.status, result.error);
    stored = true;
    return {
      messages: mediaMessages(
        result.message.id,
        result.message.createdAt,
        bot,
        destination.chat,
        result.message.images,
        input.items,
      ),
      storedMessageId: result.message.id,
    };
  } finally {
    if (!stored) cleanupMessageImages(images);
  }
}
