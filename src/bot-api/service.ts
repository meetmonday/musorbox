import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { messageBots, messageBotUpdates, users } from "../core/schema";
import { wakeBotPoll } from "./updates";

export type MessageBot = {
  userId: number;
  username: string;
  fullName: string | null;
};

export type CreatedMessageBot = MessageBot & { token: string };

export type ManagedMessageBot = MessageBot & {
  createdAt: Date;
  disabledAt: Date | null;
};

export class MessageBotManagementError extends Error {
  constructor(public readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

export const MAX_OWNED_MESSAGE_BOTS = 5;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticateMessageBot(token: string): Promise<MessageBot | null> {
  if (token.length < 10 || token.length > 200 || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) return null;
  return getDrizzle()
    .select({
      userId: users.id,
      username: users.username,
      fullName: users.fullName,
    })
    .from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(and(
      eq(messageBots.tokenHash, tokenHash(token)),
      isNull(messageBots.disabledAt),
      eq(users.banned, false),
    ))
    .get() ?? null;
}

export async function createMessageBot(
  rawUsername: string,
  rawFullName?: string,
  ownerUserId: number | null = null,
): Promise<CreatedMessageBot> {
  const username = rawUsername.trim();
  const fullName = rawFullName?.trim() || username;
  if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
    throw new Error("Логин бота должен состоять из 3–32 латинских букв, цифр или _.");
  }
  if (!/bot$/i.test(username)) {
    throw new Error("Логин Telegram-совместимого бота должен оканчиваться на bot.");
  }
  if (Array.from(fullName).length > 80) {
    throw new Error("Имя бота должно быть не длиннее 80 символов.");
  }

  const db = getDrizzle();
  if (db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()) {
    throw new Error(`Логин «${username}» уже занят.`);
  }

  // Бот не должен иметь известный пароль и входить через пользовательскую форму.
  const passwordHash = await hash(randomBytes(32).toString("hex"), 10);
  return db.transaction((tx): CreatedMessageBot => {
    if (ownerUserId !== null) {
      const owned = tx.select({ n: count() }).from(messageBots)
        .where(eq(messageBots.ownerUserId, ownerUserId)).get()?.n ?? 0;
      if (owned >= MAX_OWNED_MESSAGE_BOTS) {
        throw new MessageBotManagementError(409, `Можно создать не более ${MAX_OWNED_MESSAGE_BOTS} ботов.`);
      }
    }
    const user = tx.insert(users).values({
      username,
      fullName,
      passwordHash,
    }).returning({ id: users.id }).get();
    if (!user) throw new Error("Не удалось создать пользователя бота.");

    const token = `${user.id}:${randomBytes(32).toString("base64url")}`;
    tx.insert(messageBots).values({
      userId: user.id,
      ownerUserId,
      tokenHash: tokenHash(token),
    }).run();
    return { userId: user.id, username, fullName, token };
  });
}

export async function createOwnedMessageBot(
  ownerUserId: number,
  rawUsername: string,
  rawFullName?: string,
): Promise<CreatedMessageBot> {
  const db = getDrizzle();
  const owner = db.select({ id: users.id, banned: users.banned })
    .from(users).where(eq(users.id, ownerUserId)).get();
  if (!owner || owner.banned) throw new MessageBotManagementError(403, "Учётная запись недоступна.");
  const owned = db.select({ n: count() }).from(messageBots)
    .where(eq(messageBots.ownerUserId, ownerUserId)).get()?.n ?? 0;
  if (owned >= MAX_OWNED_MESSAGE_BOTS) {
    throw new MessageBotManagementError(409, `Можно создать не более ${MAX_OWNED_MESSAGE_BOTS} ботов.`);
  }
  try {
    return await createMessageBot(rawUsername, rawFullName, ownerUserId);
  } catch (error) {
    if (error instanceof MessageBotManagementError) throw error;
    throw new MessageBotManagementError(400, error instanceof Error ? error.message : "Не удалось создать бота.");
  }
}

export function listOwnedMessageBots(ownerUserId: number): ManagedMessageBot[] {
  return getDrizzle().select({
    userId: users.id,
    username: users.username,
    fullName: users.fullName,
    createdAt: messageBots.createdAt,
    disabledAt: messageBots.disabledAt,
  }).from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(eq(messageBots.ownerUserId, ownerUserId))
    .orderBy(asc(messageBots.createdAt), asc(messageBots.userId))
    .all();
}

function ownedBot(ownerUserId: number, botUserId: number): ManagedMessageBot {
  const bot = getDrizzle().select({
    userId: users.id,
    username: users.username,
    fullName: users.fullName,
    createdAt: messageBots.createdAt,
    disabledAt: messageBots.disabledAt,
  }).from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(and(eq(messageBots.userId, botUserId), eq(messageBots.ownerUserId, ownerUserId)))
    .get();
  if (!bot) throw new MessageBotManagementError(404, "Бот не найден.");
  return bot;
}

function newToken(bot: MessageBot): CreatedMessageBot {
  const token = `${bot.userId}:${randomBytes(32).toString("base64url")}`;
  getDrizzle().update(messageBots)
    .set({ tokenHash: tokenHash(token), disabledAt: null })
    .where(eq(messageBots.userId, bot.userId))
    .run();
  wakeBotPoll(bot.userId);
  return { ...bot, token };
}

export function rotateOwnedMessageBotToken(ownerUserId: number, botUserId: number): CreatedMessageBot {
  const bot = ownedBot(ownerUserId, botUserId);
  if (bot.disabledAt) throw new MessageBotManagementError(409, "Сначала включите бота.");
  return newToken(bot);
}

export function disableOwnedMessageBot(ownerUserId: number, botUserId: number): void {
  const bot = ownedBot(ownerUserId, botUserId);
  if (bot.disabledAt) return;
  const revokedHash = tokenHash(`revoked:${bot.userId}:${randomBytes(32).toString("hex")}`);
  getDrizzle().transaction((tx) => {
    tx.update(messageBots)
      .set({ tokenHash: revokedHash, disabledAt: new Date() })
      .where(eq(messageBots.userId, bot.userId))
      .run();
    tx.delete(messageBotUpdates).where(eq(messageBotUpdates.botUserId, bot.userId)).run();
  });
  wakeBotPoll(bot.userId);
}

export function enableOwnedMessageBot(ownerUserId: number, botUserId: number): CreatedMessageBot {
  const bot = ownedBot(ownerUserId, botUserId);
  if (!bot.disabledAt) throw new MessageBotManagementError(409, "Бот уже включён. Можно заменить его токен.");
  return newToken(bot);
}

export function deleteOwnedMessageBot(ownerUserId: number, botUserId: number): void {
  const bot = ownedBot(ownerUserId, botUserId);
  if (!bot.disabledAt) {
    throw new MessageBotManagementError(409, "Перед окончательным удалением отключите бота.");
  }
  getDrizzle().delete(users).where(eq(users.id, bot.userId)).run();
  wakeBotPoll(bot.userId);
}

export function renameOwnedMessageBot(
  ownerUserId: number,
  botUserId: number,
  rawFullName: string,
): void {
  const bot = ownedBot(ownerUserId, botUserId);
  const fullName = rawFullName.trim();
  if (!fullName || Array.from(fullName).length > 80) {
    throw new MessageBotManagementError(400, "Имя бота должно содержать от 1 до 80 символов.");
  }
  getDrizzle().update(users).set({ fullName }).where(eq(users.id, bot.userId)).run();
}

export function rotateMessageBotToken(rawUsername: string): CreatedMessageBot {
  const username = rawUsername.trim();
  const db = getDrizzle();
  const bot = db.select({
    userId: users.id,
    username: users.username,
    fullName: users.fullName,
  }).from(messageBots)
    .innerJoin(users, eq(users.id, messageBots.userId))
    .where(eq(users.username, username))
    .get();
  if (!bot) throw new Error(`Бот «${username}» не найден.`);
  const token = `${bot.userId}:${randomBytes(32).toString("base64url")}`;
  db.update(messageBots)
    .set({ tokenHash: tokenHash(token), disabledAt: null })
    .where(eq(messageBots.userId, bot.userId))
    .run();
  wakeBotPoll(bot.userId);
  return { ...bot, token };
}
