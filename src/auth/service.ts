import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { sessions, users } from "../core/schema";

export type AuthResult =
  | { ok: true; userId: number; token: string; expiresAt: Date }
  | { ok: false; error: string };

const SESSION_DAYS = 30;

export async function login(username: string, password: string): Promise<AuthResult> {
  const db = getDrizzle();
  const user = await db.query.users.findFirst({
    where: eq(users.username, username.trim()),
  });
  if (!user) return { ok: false, error: "Неверный логин или пароль." };
  const valid = await compare(password, user.passwordHash);
  if (!valid) return { ok: false, error: "Неверный логин или пароль." };
  return createSession(user.id);
}

export async function register(username: string, password: string): Promise<AuthResult> {
  const name = username.trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) {
    return { ok: false, error: "Логин должен состоять из 3-32 латинских букв, цифр или _." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Пароль должен быть не короче 6 символов." };
  }
  const db = getDrizzle();
  const existing = await db.query.users.findFirst({ where: eq(users.username, name) });
  if (existing) return { ok: false, error: `Пользователь «${name}» уже существует.` };
  const passwordHash = await hash(password, 10);
  const ids = await db.insert(users).values({ username: name, passwordHash }).returning({ id: users.id });
  return createSession(ids[0]!.id);
}

async function createSession(userId: number): Promise<AuthResult> {
  const db = getDrizzle();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ token, userId, expiresAt });
  return { ok: true, userId, token, expiresAt };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = getDrizzle();
  await db.delete(sessions).where(eq(sessions.token, token));
}