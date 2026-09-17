import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
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
  if (user.banned) return { ok: false, error: "Учётная запись заблокирована." };
  return createSession(user.id, user.passwordHash);
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

async function createSession(userId: number, expectedHash?: string): Promise<AuthResult> {
  const db = getDrizzle();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return db.transaction((tx): AuthResult => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user || user.banned) return { ok: false, error: "Учётная запись заблокирована." };
    if (expectedHash && user.passwordHash !== expectedHash) {
      return { ok: false, error: "Пароль изменён. Войдите снова." };
    }
    tx.insert(sessions).values({ token, userId, expiresAt }).run();
    tx.update(users).set({ last_seen_at: new Date() }).where(eq(users.id, userId)).run();
    return { ok: true, userId, token, expiresAt };
  });
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDrizzle();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.banned) return { ok: false, error: "Учётная запись заблокирована." };
  if (!(await compare(currentPassword, user.passwordHash))) {
    return { ok: false, error: "Неверный текущий пароль." };
  }
  if (newPassword.length < 6 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return { ok: false, error: "Новый пароль должен содержать не менее 6 символов и не более 72 байт UTF-8." };
  }
  const passwordHash = await hash(newPassword, 10);
  return db.transaction((tx) => {
    const updated = tx.update(users).set({ passwordHash }).where(and(
      eq(users.id, userId),
      eq(users.banned, false),
      eq(users.passwordHash, user.passwordHash),
    )).returning({ id: users.id }).get();
    if (!updated) return { ok: false as const, error: "Не удалось изменить пароль. Войдите снова." };
    tx.delete(sessions).where(eq(sessions.userId, userId)).run();
    return { ok: true as const };
  });
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = getDrizzle();
  await db.delete(sessions).where(eq(sessions.token, token));
}