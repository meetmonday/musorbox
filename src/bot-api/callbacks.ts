import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import {
  messageBots,
  messageGroupMembers,
  messageGroupMessages,
  messageGroups,
  privateMessages,
  users,
} from "../core/schema";
import { normalizeBotReplyMarkup, storedBotReplyMarkup } from "../messages/bot-markup";
import { enqueueBotUpdate } from "./updates";
import {
  telegramBotUser,
  telegramGroupChat,
  telegramPrivateChat,
  telegramUser,
  unixTime,
} from "./telegram";
import type { TelegramMessage } from "./telegram";

type CallbackAnswer = { text: string; showAlert: boolean };
type PendingAnswer = (answer: CallbackAnswer) => void;

const pendingAnswers = new Map<string, PendingAnswer>();

function activeBot(botUserId: number) {
  return getDrizzle().select({
    userId: users.id,
    username: users.username,
    fullName: users.fullName,
  }).from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(and(
      eq(messageBots.userId, botUserId),
      isNull(messageBots.disabledAt),
      eq(users.banned, false),
    ))
    .get();
}

function callbackMessage(
  scope: "private" | "group",
  messageId: number,
  currentUser: { id: number; username: string; fullName: string | null },
): { botUserId: number; message: TelegramMessage } {
  const db = getDrizzle();
  const currentUserId = currentUser.id;
  if (scope === "private") {
    const row = db.select({
      id: privateMessages.id,
      senderId: privateMessages.senderId,
      recipientId: privateMessages.recipientId,
      body: privateMessages.body,
      replyMarkup: privateMessages.replyMarkup,
      createdAt: privateMessages.createdAt,
    }).from(privateMessages).where(and(
      eq(privateMessages.id, messageId),
      or(eq(privateMessages.senderId, currentUserId), eq(privateMessages.recipientId, currentUserId)),
    )).get();
    if (!row || row.recipientId !== currentUserId || !storedBotReplyMarkup(row.replyMarkup)) {
      throw new Error("Кнопка больше недоступна.");
    }
    const bot = activeBot(row.senderId);
    if (!bot) throw new Error("Бот сейчас недоступен.");
    return {
      botUserId: bot.userId,
      message: {
        message_id: row.id,
        date: unixTime(row.createdAt),
        from: telegramBotUser(bot),
        chat: telegramPrivateChat(currentUser),
        text: row.body,
        reply_markup: storedBotReplyMarkup(row.replyMarkup) ?? undefined,
      },
    };
  }

  const row = db.select({
    id: messageGroupMessages.id,
    groupId: messageGroupMessages.groupId,
    senderId: messageGroupMessages.senderId,
    body: messageGroupMessages.body,
    replyMarkup: messageGroupMessages.replyMarkup,
    createdAt: messageGroupMessages.createdAt,
    groupTitle: messageGroups.title,
  }).from(messageGroupMessages)
    .innerJoin(messageGroups, eq(messageGroups.id, messageGroupMessages.groupId))
    .innerJoin(messageGroupMembers, and(
      eq(messageGroupMembers.groupId, messageGroupMessages.groupId),
      eq(messageGroupMembers.userId, currentUserId),
    ))
    .where(eq(messageGroupMessages.id, messageId))
    .get();
  if (!row || row.senderId === null || !storedBotReplyMarkup(row.replyMarkup)) {
    throw new Error("Кнопка больше недоступна.");
  }
  const bot = activeBot(row.senderId);
  if (!bot) throw new Error("Бот сейчас недоступен.");
  return {
    botUserId: bot.userId,
    message: {
      message_id: row.id,
      date: unixTime(row.createdAt),
      from: telegramBotUser(bot),
      chat: telegramGroupChat({ id: row.groupId, title: row.groupTitle }),
      text: row.body,
      reply_markup: storedBotReplyMarkup(row.replyMarkup) ?? undefined,
    },
  };
}

export async function submitBotCallback(
  currentUserId: number,
  scope: "private" | "group",
  messageId: number,
  callbackData: string,
  signal: AbortSignal,
): Promise<CallbackAnswer> {
  const user = getDrizzle().select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
  }).from(users).where(and(eq(users.id, currentUserId), eq(users.banned, false))).get();
  if (!user) throw new Error("Пользователь недоступен.");

  const target = callbackMessage(scope, messageId, user);
  const markup = normalizeBotReplyMarkup(target.message.reply_markup);
  if (!markup?.inline_keyboard.some((row) => row.some((button) => button.callback_data === callbackData))) {
    throw new Error("Кнопка больше недоступна.");
  }

  const callbackId = randomUUID();
  let finish: PendingAnswer | null = null;
  const answer = new Promise<CallbackAnswer>((resolve) => {
    let completed = false;
    const done = (value: CallbackAnswer) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
      resolve(value);
    };
    const aborted = () => done({ text: "", showAlert: false });
    const timeout = setTimeout(() => done({ text: "", showAlert: false }), 15_000);
    finish = done;
    pendingAnswers.set(callbackId, done);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });

  try {
    enqueueBotUpdate(target.botUserId, {
      callback_query: {
        id: callbackId,
        from: telegramUser(user),
        message: target.message,
        chat_instance: String(target.message.chat.id),
        data: callbackData,
      },
    });
    return await answer;
  } finally {
    if (pendingAnswers.get(callbackId) === finish) pendingAnswers.delete(callbackId);
  }
}

export function answerBotCallback(callbackQueryId: string, text: string, showAlert: boolean): void {
  pendingAnswers.get(callbackQueryId)?.({ text, showAlert });
}
