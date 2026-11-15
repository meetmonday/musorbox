import { and, eq, ne } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import {
  messageBots,
  messageGroupMembers,
  messageGroups,
  users,
} from "../core/schema";
import { enqueueBotUpdate } from "./updates";
import {
  commandEntities,
  telegramGroupChat,
  telegramPrivateChat,
  telegramUser,
  unixTime,
} from "./telegram";
import type { TelegramMessage } from "./telegram";

type StoredMessage = {
  id: number;
  senderId: number;
  body: string;
  createdAt: Date;
};

const userSelection = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
};

function isBotUser(userId: number): boolean {
  return Boolean(getDrizzle()
    .select({ userId: messageBots.userId })
    .from(messageBots)
    .where(eq(messageBots.userId, userId))
    .get());
}

function updatePayload(message: TelegramMessage): Record<string, unknown> {
  return { message };
}

function commandLabel(body: string): string {
  return /^\/[A-Za-z0-9_]+/.exec(body)?.[0] ?? "обычное сообщение";
}

export function deliverPrivateMessageToBot(
  message: StoredMessage & { recipientId: number },
): void {
  if (isBotUser(message.senderId)) return;
  const db = getDrizzle();
  const bot = db.select({
    userId: users.id,
    username: users.username,
  }).from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(and(eq(messageBots.userId, message.recipientId), eq(users.banned, false)))
    .get();
  if (!bot) return;
  const sender = db.select(userSelection).from(users).where(eq(users.id, message.senderId)).get();
  if (!sender) return;

  const telegramMessage: TelegramMessage = {
    message_id: message.id,
    date: unixTime(message.createdAt),
    from: telegramUser(sender),
    chat: telegramPrivateChat(sender),
    text: message.body,
    entities: commandEntities(message.body),
  };
  const updateId = enqueueBotUpdate(bot.userId, updatePayload(telegramMessage));
  console.log(
    `[bot-api] update ${updateId} поставлен для @${bot.username}: `
    + `private userId=${sender.id}, messageId=${message.id}, ${commandLabel(message.body)}`,
  );
}

export function deliverGroupMessageToBots(
  groupId: number,
  message: StoredMessage,
): void {
  // Telegram не пересылает сообщения ботов другим ботам; это также защищает от циклов.
  if (isBotUser(message.senderId)) return;
  const db = getDrizzle();
  const [sender, group] = [
    db.select(userSelection).from(users).where(eq(users.id, message.senderId)).get(),
    db.select({ id: messageGroups.id, title: messageGroups.title })
      .from(messageGroups).where(eq(messageGroups.id, groupId)).get(),
  ];
  if (!sender || !group) return;
  const bots = db.select({ userId: users.id, username: users.username })
    .from(messageGroupMembers)
    .innerJoin(messageBots, eq(messageBots.userId, messageGroupMembers.userId))
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(and(
      eq(messageGroupMembers.groupId, groupId),
      ne(messageGroupMembers.userId, message.senderId),
      eq(users.banned, false),
    ))
    .all();
  if (!bots.length) return;

  const telegramMessage: TelegramMessage = {
    message_id: message.id,
    date: unixTime(message.createdAt),
    from: telegramUser(sender),
    chat: telegramGroupChat(group),
    text: message.body,
    entities: commandEntities(message.body),
  };
  for (const bot of bots) {
    const updateId = enqueueBotUpdate(bot.userId, updatePayload(telegramMessage));
    console.log(
      `[bot-api] update ${updateId} поставлен для @${bot.username}: `
      + `groupId=${groupId}, messageId=${message.id}, ${commandLabel(message.body)}`,
    );
  }
}
