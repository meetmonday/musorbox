import { createHash, randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import type { SessionUser } from "../core/middleware";
import { apiTokens, notifications, users } from "../core/schema";

export async function authenticateApiToken(token: string): Promise<SessionUser | undefined> {
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  const db = getDrizzle();
  const user = db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    avatarUrl: users.avatarUrl,
    banned: users.banned,
  }).from(apiTokens).innerJoin(users, eq(apiTokens.userId, users.id))
    .where(and(eq(apiTokens.tokenHash, createHash("sha256").update(token).digest("hex")), eq(users.banned, false))).get();
  if (!user) return undefined;
  const unread = db.select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, false))).get();
  return { ...user, unreadCount: unread?.n ?? 0 };
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
