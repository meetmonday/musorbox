import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { getDrizzle } from "./db";
import { sessions, users, notifications } from "./schema";
import { and, count, eq } from "drizzle-orm";

export function isStaff(user: { role: string; banned?: boolean } | null | undefined): boolean {
  return !user?.banned && (user?.role === "editor" || user?.role === "admin");
}

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  avatarUrl: string | null;
  banned: boolean;
  unreadCount: number;
};

export type UserContext = {
  user?: SessionUser;
};

export const sessionMiddleware = createMiddleware<{ Variables: UserContext }>(async (c, next) => {
  const token = getCookie(c, "session_token");
  if (token) {
    const db = getDrizzle();
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.token, token),
    });
    if (session && session.expiresAt.getTime() > Date.now()) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, session.userId),
      });
      if (user && !user.banned) {
        const unread = await db.select({ n: count() }).from(notifications)
          .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));
        c.set("user", {
          id: user.id,
          username: user.username,
          role: user.role,
          avatarUrl: user.avatarUrl,
          banned: user.banned,
          unreadCount: unread[0]?.n ?? 0,
        });
      }
    }
  }
  await next();
});

export const requireAuth = createMiddleware<{ Variables: UserContext }>(async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.redirect("/login");
  }
  await next();
});