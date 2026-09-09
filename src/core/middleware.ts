import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { getDrizzle } from "./db";
import { sessions, users } from "./schema";
import { eq } from "drizzle-orm";

export type UserContext = {
  user?: {
    id: number;
    username: string;
    role: string;
    avatarUrl: string | null;
  };
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
      if (user) {
        c.set("user", {
          id: user.id,
          username: user.username,
          role: user.role,
          avatarUrl: user.avatarUrl,
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