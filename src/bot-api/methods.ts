import { and, eq, or } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import {
  messageBots,
  messageConversations,
  messageGroupMembers,
  messageGroupMessages,
  messageGroups,
  messageImages,
  privateMessages,
  users,
} from "../core/schema";
import { sendGroupMessage } from "../messages/group-service";
import { sendPrivateMessage } from "../messages/service";
import { cleanupMessageImages, MessageImageError, prepareMessageImages } from "../messages/media";
import type { ApiMessageImage } from "../messages/media";
import { publishMessageEvent } from "../messages/realtime";
import { normalizeBotReplyMarkup, serializedBotReplyMarkup } from "../messages/bot-markup";
import type { BotInlineKeyboardMarkup } from "../messages/bot-markup";
import type { MessageBot } from "./service";
import type { MediaGroupInput, TelegramMediaItem } from "./media";
import {
  musorgramGroupId,
  telegramBotUser,
  telegramGroupChat,
  telegramPrivateChat,
  telegramUser,
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

function positiveInteger(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BotMethodError(400, `Bad Request: ${name} must be a positive integer`);
  }
  return parsed;
}

function jsonArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : undefined;
}

function replyMarkup(value: unknown): BotInlineKeyboardMarkup | null {
  try {
    return normalizeBotReplyMarkup(value);
  } catch (error) {
    throw new BotMethodError(400, `Bad Request: ${error instanceof Error ? error.message : "invalid reply_markup"}`);
  }
}

function outgoingMessage(
  id: number,
  createdAt: Date,
  body: string,
  bot: MessageBot,
  chat: TelegramMessage["chat"],
  entities: unknown,
  markup: BotInlineKeyboardMarkup | null,
): TelegramMessage {
  return {
    message_id: id,
    date: unixTime(createdAt),
    from: telegramBotUser(bot),
    chat,
    text: body,
    entities: jsonArray(entities),
    reply_markup: markup ?? undefined,
  };
}

export async function sendBotMessage(
  bot: MessageBot,
  params: Record<string, unknown>,
): Promise<TelegramMessage> {
  const destination = resolveBotChat(bot, params.chat_id);
  const body = text(params.text);
  const markup = replyMarkup(params.reply_markup);
  const storedMarkup = serializedBotReplyMarkup(markup);
  if (destination.kind === "private") {
    const result = await sendPrivateMessage(bot.userId, destination.target.username, body, [], storedMarkup);
    if (!result.ok) throw new BotMethodError(result.status, result.error);
    return outgoingMessage(
      result.message.id,
      result.message.createdAt,
      result.message.body,
      bot,
      destination.chat,
      params.entities,
      markup,
    );
  }
  const result = await sendGroupMessage(bot.userId, destination.group.id, body, [], storedMarkup);
  if (!result.ok) throw new BotMethodError(result.status, result.error);
  return outgoingMessage(
    result.message.id,
    result.message.createdAt,
    result.message.body,
    bot,
    destination.chat,
    params.entities,
    markup,
  );
}

function requireGroupMembership(botUserId: number, groupId: number): void {
  const member = getDrizzle().select({ userId: messageGroupMembers.userId })
    .from(messageGroupMembers)
    .where(and(eq(messageGroupMembers.groupId, groupId), eq(messageGroupMembers.userId, botUserId)))
    .get();
  if (!member) throw new BotMethodError(403, "Forbidden: bot is not a member of the group chat");
}

export function deleteBotMessage(bot: MessageBot, params: Record<string, unknown>): void {
  const destination = resolveBotChat(bot, params.chat_id);
  const messageId = positiveInteger(params.message_id, "message_id");
  const db = getDrizzle();
  if (destination.kind === "private") {
    const message = db.select({
      id: privateMessages.id,
      senderId: privateMessages.senderId,
      recipientId: privateMessages.recipientId,
    }).from(privateMessages).where(and(
      eq(privateMessages.id, messageId),
      or(
        and(eq(privateMessages.senderId, bot.userId), eq(privateMessages.recipientId, destination.target.id)),
        and(eq(privateMessages.senderId, destination.target.id), eq(privateMessages.recipientId, bot.userId)),
      ),
    )).get();
    if (!message) throw new BotMethodError(400, "Bad Request: message to delete not found");
    const images = db.select({ storageKey: messageImages.storageKey, thumbnailKey: messageImages.thumbnailKey })
      .from(messageImages).where(eq(messageImages.privateMessageId, messageId)).all();
    db.delete(privateMessages).where(eq(privateMessages.id, messageId)).run();
    cleanupMessageImages(images);
    publishMessageEvent(bot.userId, { type: "delete", peerId: destination.target.id, messageId });
    publishMessageEvent(destination.target.id, { type: "delete", peerId: bot.userId, messageId });
    return;
  }

  requireGroupMembership(bot.userId, destination.group.id);
  const message = db.select({ id: messageGroupMessages.id })
    .from(messageGroupMessages)
    .where(and(eq(messageGroupMessages.id, messageId), eq(messageGroupMessages.groupId, destination.group.id)))
    .get();
  if (!message) throw new BotMethodError(400, "Bad Request: message to delete not found");
  const images = db.select({ storageKey: messageImages.storageKey, thumbnailKey: messageImages.thumbnailKey })
    .from(messageImages).where(eq(messageImages.groupMessageId, messageId)).all();
  db.delete(messageGroupMessages).where(eq(messageGroupMessages.id, messageId)).run();
  cleanupMessageImages(images);
  const members = db.select({ userId: messageGroupMembers.userId }).from(messageGroupMembers)
    .where(eq(messageGroupMembers.groupId, destination.group.id)).all();
  for (const member of members) {
    publishMessageEvent(member.userId, { type: "delete", groupId: destination.group.id, messageId });
  }
}

export function editBotMessageReplyMarkup(
  bot: MessageBot,
  params: Record<string, unknown>,
): TelegramMessage {
  const destination = resolveBotChat(bot, params.chat_id);
  const messageId = positiveInteger(params.message_id, "message_id");
  const markup = replyMarkup(params.reply_markup);
  const storedMarkup = serializedBotReplyMarkup(markup);
  const db = getDrizzle();
  if (destination.kind === "private") {
    const updated = db.update(privateMessages).set({ replyMarkup: storedMarkup }).where(and(
      eq(privateMessages.id, messageId),
      eq(privateMessages.senderId, bot.userId),
      eq(privateMessages.recipientId, destination.target.id),
    )).returning().get();
    if (!updated) throw new BotMethodError(400, "Bad Request: message to edit not found");
    publishMessageEvent(destination.target.id, { type: "edit", peerId: bot.userId, messageId });
    return outgoingMessage(
      updated.id,
      updated.createdAt,
      updated.body,
      bot,
      destination.chat,
      undefined,
      markup,
    );
  }

  requireGroupMembership(bot.userId, destination.group.id);
  const updated = db.update(messageGroupMessages).set({ replyMarkup: storedMarkup }).where(and(
    eq(messageGroupMessages.id, messageId),
    eq(messageGroupMessages.groupId, destination.group.id),
    eq(messageGroupMessages.senderId, bot.userId),
  )).returning().get();
  if (!updated) throw new BotMethodError(400, "Bad Request: message to edit not found");
  const members = db.select({ userId: messageGroupMembers.userId }).from(messageGroupMembers)
    .where(eq(messageGroupMembers.groupId, destination.group.id)).all();
  for (const member of members) {
    publishMessageEvent(member.userId, { type: "edit", groupId: destination.group.id, messageId });
  }
  return outgoingMessage(
    updated.id,
    updated.createdAt,
    updated.body,
    bot,
    destination.chat,
    undefined,
    markup,
  );
}

export function getBotChatAdministrators(
  bot: MessageBot,
  params: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const destination = resolveBotChat(bot, params.chat_id);
  if (destination.kind !== "group") throw new BotMethodError(400, "Bad Request: chat is not a group");
  requireGroupMembership(bot.userId, destination.group.id);
  const owner = getDrizzle().select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
  }).from(messageGroups)
    .innerJoin(users, eq(users.id, messageGroups.ownerId))
    .where(eq(messageGroups.id, destination.group.id))
    .get();
  if (!owner) throw new BotMethodError(404, "Bad Request: chat not found");
  return [{ status: "creator", user: telegramUser(owner), is_anonymous: false }];
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
