import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import type { SessionUser } from "../core/middleware";
import { apiTokens, appTokens, notifications, users } from "../core/schema";
import { countUnreadMessages } from "../messages/service";

export async function authenticateApiToken(token: string): Promise<SessionUser | undefined> {
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  const db = getDrizzle();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const user = db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    avatarUrl: users.avatarUrl,
    banned: users.banned,
  }).from(apiTokens).innerJoin(users, eq(apiTokens.userId, users.id))
    .where(and(eq(apiTokens.tokenHash, tokenHash), eq(users.banned, false))).get()
    ?? db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      avatarUrl: users.avatarUrl,
      banned: users.banned,
    }).from(appTokens).innerJoin(users, eq(appTokens.userId, users.id))
      .where(and(eq(appTokens.tokenHash, tokenHash), eq(users.banned, false))).get();
  if (!user) return undefined;
  const unread = db.select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false))).get();
  const unreadMessages = await countUnreadMessages(user.id);
  return {
    ...user,
    unreadCount: unread?.n ?? 0,
    unreadMessagesCount: unreadMessages,
  };
}

const MAX_APP_TOKENS_PER_USER = 10;

export async function issueAppToken(userId: number, clientName: string): Promise<string> {
  const db = getDrizzle();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.transaction((tx) => {
    const user = tx.select({ banned: users.banned }).from(users).where(eq(users.id, userId)).get();
    if (!user || user.banned) throw new Error("Учётная запись заблокирована или удалена.");
    const existing = tx.select({ id: appTokens.id }).from(appTokens)
      .where(eq(appTokens.userId, userId))
      .orderBy(asc(appTokens.createdAt), asc(appTokens.id))
      .all();
    if (existing.length >= MAX_APP_TOKENS_PER_USER) {
      tx.delete(appTokens).where(eq(appTokens.id, existing[0]!.id)).run();
    }
    tx.insert(appTokens).values({ userId, tokenHash, clientName }).run();
    return token;
  });
}

export async function revokeAppToken(token: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  getDrizzle().delete(appTokens).where(eq(appTokens.tokenHash, tokenHash)).run();
}

export async function revokeAllAppTokens(userId: number): Promise<void> {
  getDrizzle().delete(appTokens).where(eq(appTokens.userId, userId)).run();
}

export async function rotateApiToken(userId: number): Promise<string> {
  const db = getDrizzle();
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return db.transaction((tx) => {
    const user = tx.select({ banned: users.banned }).from(users).where(eq(users.id, userId)).get();
    if (!user || user.banned) throw new Error("Учётная запись заблокирована или удалена.");
    tx.insert(apiTokens).values({ userId, tokenHash }).onConflictDoUpdate({
      target: apiTokens.userId,
      set: { tokenHash },
    }).run();
    return token;
  });
}

export async function revokeApiToken(userId: number): Promise<void> {
  getDrizzle().delete(apiTokens).where(eq(apiTokens.userId, userId)).run();
}
