import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import sharp from "sharp";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { comments, tgComments, tgThreads, tgUsers, topics, users } from "../core/schema";
import { readTelegramSettings } from "./settings";
import { fileUrl, getFile, getUserProfilePhotos } from "./client";

/** Привязка «топик сайта ↔ тема обсуждения в Telegram». */
export type TgThread = {
  topicId: number;
  chatId: number;
  messageThreadId: number;
  threadName: string;
  createdAt: Date;
};

export type TgCommentLink = {
  commentId: number;
  chatId: number;
  messageId: number;
  tgUserId: number | null;
};

/** Очередь ожидающих зеркалирования: кто-то мог создать топик, пока бот молчал. */
const inflight = new Map<string, Promise<unknown>>();

export async function getThreadForTopic(topicId: number): Promise<TgThread | null> {
  const rows = await getDrizzle()
    .select({
      topicId: tgThreads.topicId,
      chatId: tgThreads.chatId,
      messageThreadId: tgThreads.messageThreadId,
      threadName: tgThreads.threadName,
      createdAt: tgThreads.createdAt,
    })
    .from(tgThreads)
    .where(eq(tgThreads.topicId, topicId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findTopicIdForThread(chatId: number, messageThreadId: number): Promise<number | null> {
  const rows = await getDrizzle()
    .select({ topicId: tgThreads.topicId })
    .from(tgThreads)
    .where(and(eq(tgThreads.chatId, chatId), eq(tgThreads.messageThreadId, messageThreadId)))
    .limit(1);
  return rows[0]?.topicId ?? null;
}

export async function saveThread(topicId: number, chatId: number, messageThreadId: number, threadName: string): Promise<void> {
  const db = getDrizzle();
  await db.transaction(async (tx) => {
    // Если ту же тему чата заняла привязка другого топика, она устарела:
    // Telegram не переиспользует идентификаторы тем. Снимаем её вместе с
    // привязками сообщений, иначе вставка упадёт на уникальном индексе.
    const stale = await tx
      .select({ topicId: tgThreads.topicId })
      .from(tgThreads)
      .where(and(eq(tgThreads.chatId, chatId), eq(tgThreads.messageThreadId, messageThreadId)))
      .limit(1);
    if (stale[0] && stale[0].topicId !== topicId) {
      await tx.run(sql`DELETE FROM ${tgComments} WHERE ${tgComments.commentId} IN (SELECT id FROM ${comments} WHERE ${comments.topicId} = ${stale[0].topicId})`);
      await tx.delete(tgThreads).where(eq(tgThreads.topicId, stale[0].topicId));
      console.log(`[tg] снята устаревшая привязка темы ${messageThreadId} с топика ${stale[0].topicId}`);
    }
    await tx
      .insert(tgThreads)
      .values({ topicId, chatId, messageThreadId, threadName })
      .onConflictDoUpdate({
        target: tgThreads.topicId,
        set: { chatId, messageThreadId, threadName },
      });
  });
}

/** Ручная отвязка темы (сама тема чата удаляется вызывающим кодом). */
export async function forgetThread(topicId: number): Promise<TgThread | null> {
  const db = getDrizzle();
  const existing = await getThreadForTopic(topicId);
  if (!existing) return null;
  await db.transaction(async (tx) => {
    // Привязки сообщений снимаем только у комментариев этого топика: chatId
    // один на все темы чата, и иначе отвязка одной темы уносила бы связи всех
    // остальных топиков.
    await tx.run(sql`DELETE FROM ${tgComments} WHERE ${tgComments.commentId} IN (SELECT id FROM ${comments} WHERE ${comments.topicId} = ${topicId})`);
    await tx.delete(tgThreads).where(eq(tgThreads.topicId, topicId));
  });
  return existing;
}

export type TgThreadRow = TgThread & {
  topicTitle: string;
  topicSlug: string;
  topicHidden: boolean;
  mirroredComments: number;
};

export async function listThreads(limit = 50, offset = 0): Promise<TgThreadRow[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      topicId: tgThreads.topicId,
      chatId: tgThreads.chatId,
      messageThreadId: tgThreads.messageThreadId,
      threadName: tgThreads.threadName,
      createdAt: tgThreads.createdAt,
      topicTitle: topics.title,
      topicSlug: topics.slug,
      topicHidden: topics.hidden,
      mirroredComments: sql<number>`(SELECT count(*) FROM ${tgComments} WHERE ${tgComments.commentId} IN (SELECT id FROM ${comments} WHERE ${comments.topicId} = ${tgThreads.topicId}))`,
    })
    .from(tgThreads)
    .innerJoin(topics, eq(topics.id, tgThreads.topicId))
    .orderBy(desc(tgThreads.topicId))
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function countThreads(): Promise<number> {
  const rows = await getDrizzle().select({ n: sql<number>`count(*)` }).from(tgThreads);
  return Number(rows[0]?.n ?? 0);
}

export async function getCommentLink(commentId: number): Promise<TgCommentLink | null> {
  const rows = await getDrizzle()
    .select({
      commentId: tgComments.commentId,
      chatId: tgComments.chatId,
      messageId: tgComments.messageId,
      tgUserId: tgComments.tgUserId,
    })
    .from(tgComments)
    .where(eq(tgComments.commentId, commentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCommentIdForMessage(chatId: number, messageId: number): Promise<number | null> {
  const rows = await getDrizzle()
    .select({ commentId: tgComments.commentId })
    .from(tgComments)
    .where(and(eq(tgComments.chatId, chatId), eq(tgComments.messageId, messageId)))
    .limit(1);
  return rows[0]?.commentId ?? null;
}

/**
 * Привязка сообщения чата вместе с его автором в Telegram — так проверяем,
 * кто просит удалить комментарий командой-ответом.
 */
export async function findTgCommentForMessage(
  chatId: number,
  messageId: number,
): Promise<{ commentId: number; topicId: number; tgUserId: number | null } | null> {
  const rows = await getDrizzle()
    .select({ commentId: tgComments.commentId, tgUserId: tgComments.tgUserId, topicId: comments.topicId })
    .from(tgComments)
    .innerJoin(comments, eq(comments.id, tgComments.commentId))
    .where(and(eq(tgComments.chatId, chatId), eq(tgComments.messageId, messageId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function linkComment(commentId: number, chatId: number, messageId: number, tgUserId: number | null): Promise<void> {
  await getDrizzle()
    .insert(tgComments)
    .values({ commentId, chatId, messageId, tgUserId })
    .onConflictDoNothing();
}

export async function forgetCommentLink(commentId: number): Promise<void> {
  await getDrizzle().delete(tgComments).where(eq(tgComments.commentId, commentId));
}

/**
 * Собеседник из Telegram получает полноценный профиль сайта: логин — его
 * username из Telegram (если свободен), отображаемое имя — имя в чате, аватар —
 * фото профиля. Войти в такой аккаунт нельзя: пароль — случайная строка.
 */
export async function resolveTelegramAuthor(
  token: string,
  tg: { id: number; username?: string; first_name?: string; last_name?: string },
): Promise<number | null> {
  const db = getDrizzle();
  const existing = await db
    .select({ userId: tgUsers.userId })
    .from(tgUsers)
    .where(eq(tgUsers.tgUserId, tg.id))
    .limit(1);
  if (existing[0]) {
    const userId = existing[0].userId;
    void refreshShadowProfile(token, userId, tg);
    return userId;
  }

  const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(" ").trim() || tg.username || `tg_${tg.id}`;
  const username = await freeUsername(db, slugUsername(tg.username), tg.id);
  const passwordHash = await hash(randomBytes(32).toString("hex"), 10);
  const inserted = await db
    .insert(users)
    .values({
      username,
      passwordHash,
      fullName: displayName.slice(0, 100),
      // Теневые профили не должны искажать рейтинги участников сайта.
      ratingOptout: true,
      wasEverCommenter: true,
    })
    .returning({ id: users.id });
  const userId = inserted[0]?.id;
  if (!userId) return null;
  await db.insert(tgUsers).values({
    tgUserId: tg.id,
    userId,
    username: tg.username ?? null,
    firstName: tg.first_name ?? null,
    lastName: tg.last_name ?? null,
  });
  console.log(`[tg] создан профиль ${username} для tg:${tg.id}`);
  void refreshShadowProfile(token, userId, tg, true);
  return userId;
}

/** Логин по правилам сайта: латиница, цифры и подчёркивание, 3–32 символа. */
function slugUsername(username: string | undefined): string | null {
  const clean = (username ?? "").replace(/[^A-Za-z0-9_]/g, "");
  if (clean.length < 3) return null;
  return clean.slice(0, 32);
}

/** Свободный логин: при занятом добавляем суффикс, а не отнимаем у человека. */
async function freeUsername(db: ReturnType<typeof getDrizzle>, preferred: string | null, tgId: number): Promise<string> {
  const base = preferred ?? `tg_${tgId}`;
  const taken = async (name: string) => (await db.select({ id: users.id }).from(users).where(eq(users.username, name)).limit(1)).length > 0;
  if (!(await taken(base))) return base;
  for (let attempt = 2; attempt <= 50; attempt++) {
    const candidate = `${base.slice(0, 28)}_${attempt}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `tg_${tgId}`;
}

/** Имя, логин и аватар в Telegram могли измениться — подтягиваем в профиль. */
async function refreshShadowProfile(
  token: string,
  userId: number,
  tg: { id: number; username?: string; first_name?: string; last_name?: string },
  withAvatar = false,
): Promise<void> {
  const db = getDrizzle();
  const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(" ").trim();
  try {
    const current = await db
      .select({ username: users.username, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = current[0];
    if (!row) return;
    const patch: Partial<{ username: string; fullName: string | null; avatarUrl: string | null }> = {};
    if (displayName && displayName.slice(0, 100) !== row.fullName) patch.fullName = displayName.slice(0, 100);
    const preferred = slugUsername(tg.username);
    if (preferred && preferred !== row.username && !(await db.select({ id: users.id }).from(users).where(eq(users.username, preferred)).limit(1))[0]) {
      patch.username = preferred;
    }
    // Аватар докачиваем, пока его нет: собеседник мог добавить фото позже.
    if (!row.avatarUrl) patch.avatarUrl = await fetchTelegramAvatar(token, tg.id);
    if (Object.keys(patch).length > 0) await db.update(users).set(patch).where(eq(users.id, userId));
  } catch (error) {
    console.error(`[tg] не удалось обновить профиль tg:${tg.id}:`, (error as Error)?.message ?? error);
  }
}

/**
 * Аватар из профиля Telegram: один файл на каждого собеседника, при смене
 * фотографии перезаписывается. Размер и формат — как у загружаемых на сайт.
 */
async function fetchTelegramAvatar(token: string, tgUserId: number): Promise<string | null> {
  try {
    const photos = await getUserProfilePhotos(token, tgUserId, 1);
    const sizes = photos.photos?.[0];
    if (!sizes || sizes.length === 0) return null;
    const largest = sizes[sizes.length - 1]!;
    const file = await getFile(token, largest.file_id);
    if (!file.file_path) return null;
    const res = await fetch(fileUrl(token, file.file_path), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const source = Buffer.from(await res.arrayBuffer());
    const image = await sharp(source, { animated: false })
      .rotate()
      .resize(128, 128, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
    mkdirSync("public/avatars", { recursive: true });
    await Bun.write(`public/avatars/tg_${tgUserId}.webp`, image);
    return `/avatars/tg_${tgUserId}.webp`;
  } catch (error) {
    console.error(`[tg] не удалось получить аватар tg:${tgUserId}:`, (error as Error)?.message ?? error);
    return null;
  }
}

/** Защита от гонки: работа с одним ключом выполняется по очереди. */
export function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = inflight.get(key);
  const run = (async () => {
    if (previous) await previous.catch(() => undefined);
    return task();
  })();
  inflight.set(key, run);
  // Очистку прикрепляем к уже обработанному Promise: иначе отказ задачи
  // превратился бы в необработанный reject и остановил бы весь сервер.
  void run.then(
    () => dropLock(key, run),
    () => dropLock(key, run),
  );
  return run;
}

/** Защита от гонки: два комментария подряд не должны создать две темы в чате. */
export function withTopicLock<T>(topicId: number, task: () => Promise<T>): Promise<T> {
  return withKeyLock(`topic:${topicId}`, task);
}

function dropLock(key: string, run: Promise<unknown>): void {
  if (inflight.get(key) === run) inflight.delete(key);
}

/** Прямое обновление тела комментария: пришло редактирование из Telegram. */
export async function setCommentBody(commentId: number, body: string): Promise<boolean> {
  const rows = await getDrizzle()
    .update(comments)
    .set({ body, editedAt: new Date() })
    .where(eq(comments.id, commentId))
    .returning({ id: comments.id });
  return rows.length > 0;
}

/** Всё, что нужно странице топика, чтобы показать связь с темой чата. */
export type TopicTelegramInfo = {
  configured: boolean;
  thread: TgThread | null;
  chatUsername: string | null;
};

export async function telegramInfoForTopic(topicId: number): Promise<TopicTelegramInfo> {
  const [settings, thread] = await Promise.all([readTelegramSettings(), getThreadForTopic(topicId)]);
  return {
    configured: settings.configured,
    thread,
    chatUsername: settings.chatUsername,
  };
}
