import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { messageBots, users } from "../core/schema";

export type MessageBot = {
  userId: number;
  username: string;
  fullName: string | null;
};

export type CreatedMessageBot = MessageBot & { token: string };

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
    .where(and(eq(messageBots.tokenHash, tokenHash(token)), eq(users.banned, false)))
    .get() ?? null;
}

export async function createMessageBot(
  rawUsername: string,
  rawFullName?: string,
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
    const user = tx.insert(users).values({
      username,
      fullName,
      passwordHash,
    }).returning({ id: users.id }).get();
    if (!user) throw new Error("Не удалось создать пользователя бота.");

    const token = `${user.id}:${randomBytes(32).toString("base64url")}`;
    tx.insert(messageBots).values({
      userId: user.id,
      tokenHash: tokenHash(token),
    }).run();
    return { userId: user.id, username, fullName, token };
  });
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
    .set({ tokenHash: tokenHash(token) })
    .where(eq(messageBots.userId, bot.userId))
    .run();
  return { ...bot, token };
}
