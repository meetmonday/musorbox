import { and, eq, isNull } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { categories, comments, topics, tgThreads, users } from "../core/schema";
import { config } from "../core/config";
import { excerpt, formatDate } from "../core/utils";
import {
  TelegramApiError,
  createForumTopic,
  deleteForumTopic,
  deleteMessage,
  editForumTopicName,
  editMessageText,
  editRichMessage,
  sendMessage,
  sendRichMessage,
  sendRichMessageWithFiles,
  type UploadedFile,
} from "./client";
import { htmlToRichBlocks, photoBlocks, richBlocksToPlainText, siteUrlResolver, toInputRichBlocks } from "./format";
import { attachBlockImages } from "./media";
import { readTelegramSettings, type TelegramSettings } from "./settings";
import {
  forgetCommentLink,
  forgetThread,
  getCommentLink,
  getThreadForTopic,
  linkComment,
  saveThread,
  withTopicLock,
  type TgCommentLink,
  type TgThread,
} from "./service";

/**
 * Исходящее зеркалирование: топик сайта становится темой обсуждения, каждый
 * комментарий — сообщением в ней. Ошибки бота никогда не ломают сайт:
 * всё пишется в лог, а топик и комментарий остаются на месте.
 */

const QUEUE: Array<() => Promise<void>> = [];
let queueBusy = false;

/**
 * Глобальный выключатель зеркалирования. Нужен сиду: `bun run seed` создаёт
 * десятки демо-топиков, и без этого чат завалило бы анонсами.
 */
let mirrorEnabled = true;

export function setTelegramMirrorEnabled(enabled: boolean): void {
  mirrorEnabled = enabled;
}

/** Больше десяти картинок в одном сообщении чат не покажет как следует. */
const MAX_TOPIC_IMAGES = 10;

/** Сообщения боту уходят по очереди с паузой — Telegram ограничивает частоту. */
function enqueue(task: () => Promise<void>): void {
  QUEUE.push(task);
  if (queueBusy) return;
  queueBusy = true;
  void (async () => {
    while (QUEUE.length > 0) {
      const next = QUEUE.shift()!;
      try {
        await next();
      } catch (error) {
        console.error("[tg] ошибка зеркалирования:", (error as Error)?.message ?? error);
      }
      await new Promise((resolve) => setTimeout(resolve, config.telegram.sendIntervalMs));
    }
    queueBusy = false;
  })();
}

function logMirrorError(what: string, error: unknown): void {
  const reason = error instanceof TelegramApiError ? `${error.code} ${error.description}` : ((error as Error)?.message ?? String(error));
  console.error(`[tg] ${what}: ${reason}`);
}

type TopicInfo = {
  id: number;
  title: string;
  slug: string;
  body: string;
  leadImage: string | null;
  authorName: string;
  categoryName: string;
  /** Абсолютные адреса картинок топика — их увидят в теме чата. */
  images: string[];
};

/**
 * Картинки топика в том порядке, в каком они идут в тексте; ведущая картинка
 * идёт первой. Адреса делаем абсолютными: Telegram скачивает медиа сам.
 */
function collectTopicImages(leadImage: string | null, body: string): string[] {
  const resolver = siteUrlResolver();
  const urls: string[] = [];
  const push = (src: string | null | undefined) => {
    if (!src) return;
    const absolute = resolver(src.trim());
    if (!/^https?:\/\//i.test(absolute) || urls.includes(absolute)) return;
    urls.push(absolute);
  };
  push(leadImage);
  for (const match of String(body ?? "").matchAll(/<img[^>]*\ssrc="([^"]+)"/gi)) push(match[1]);
  return urls.slice(0, MAX_TOPIC_IMAGES);
}

async function loadTopic(topicId: number): Promise<TopicInfo | null> {
  const rows = await getDrizzle()
    .select({
      id: topics.id,
      title: topics.title,
      slug: topics.slug,
      body: topics.body,
      leadImage: topics.leadImage,
      authorName: users.username,
      categoryName: categories.name,
    })
    .from(topics)
    .innerJoin(users, eq(users.id, topics.authorId))
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .where(eq(topics.id, topicId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    body: row.body,
    leadImage: row.leadImage,
    authorName: row.authorName,
    categoryName: row.categoryName,
    images: collectTopicImages(row.leadImage, row.body),
  };
}

type CommentInfo = {
  id: number;
  topicId: number;
  parentId: number | null;
  body: string;
  authorName: string;
  createdAt: Date;
  topicSlug: string;
};

async function loadComment(commentId: number): Promise<CommentInfo | null> {
  const rows = await getDrizzle()
    .select({
      id: comments.id,
      topicId: comments.topicId,
      parentId: comments.parentId,
      body: comments.body,
      authorName: users.username,
      createdAt: comments.createdAt,
      topicSlug: topics.slug,
    })
    .from(comments)
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.id, commentId), isNull(comments.remoteActorId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    body: row.body,
    // Автор мог быть удалён — комментарий всё равно зеркалируем.
    authorName: row.authorName ?? "deleted",
    createdAt: row.createdAt,
    topicSlug: row.topicSlug,
  };
}

export function topicUrl(topic: { id: number; slug: string }): string {
  return `${config.baseUrl}/topics/${topic.id}/${topic.slug}`;
}

function commentUrl(comment: CommentInfo): string {
  return `${topicUrl({ id: comment.topicId, slug: comment.topicSlug })}#div_comment_${comment.id}`;
}

function topicName(topicId: number, title: string): string {
  return title.trim().slice(0, 120) || `Топик ${topicId}`;
}

/** Создаёт тему обсуждения под топик, если её ещё нет. */
async function ensureThread(topicId: number, settings: TelegramSettings): Promise<TgThread | null> {
  const existing = await getThreadForTopic(topicId);
  if (existing) return existing;
  const topic = await loadTopic(topicId);
  if (!topic) return null;
  const name = topicName(topicId, topic.title);
  const created = await createForumTopic(settings.botToken, settings.chatId, name);
  await saveThread(topicId, Number(settings.chatId), created.message_thread_id, name);
  console.log(`[tg] создана тема «${name}» для топика ${topicId} (message_thread_id=${created.message_thread_id})`);
  const thread: TgThread = {
    topicId,
    chatId: Number(settings.chatId),
    messageThreadId: created.message_thread_id,
    threadName: name,
    createdAt: new Date(),
  };
  // Анонс не должен ронять зеркалирование: у него своя тихая обработка ошибок.
  void sendTopicIntro(thread, topic, settings).catch((error) =>
    logMirrorError(`не удалось отправить анонс топика ${topicId}`, error),
  );
  return thread;
}

/** Первое сообщение темы: заголовок, картинки топика, анонс и ссылка. */
async function sendTopicIntro(thread: TgThread, topic: TopicInfo, settings: TelegramSettings): Promise<void> {
  const blocks: unknown[] = [
    { type: "heading", size: 2, text: topic.title },
    ...photoBlocks(topic.images),
    {
      type: "paragraph",
      text: `Автор: ${topic.authorName}${topic.categoryName ? ` · раздел: ${topic.categoryName}` : ""}`,
    },
    { type: "paragraph", text: excerpt(topic.body, 400) },
    { type: "buttons", buttons: [{ text: "Читать на сайте", url: topicUrl(topic) }] },
  ];
  const sent = await sendRichOrText(settings, thread.messageThreadId, blocks, {
    fallbackText: `${topic.title}\n${topic.authorName}\n${excerpt(topic.body, 500)}\n${topicUrl(topic)}\n\nКартинки топика: ${topic.images.join("\n")}`.trim(),
  });
  if (sent) console.log(`[tg] анонс топика ${thread.topicId} отправлен в тему ${thread.messageThreadId} (message_id=${sent})`);
}

/**
 * Отправка «богатым» сообщением с запасными путями. Порядок такой:
 *  1) картинки заливаем боту сами (multipart + `attach://`) — Telegram не зависит
 *     от доступности нашего сайта;
 *  2) то же сообщение с адресами — если сайт отдаёт файлы наружу;
 *  3) без вложений;
 *  4) простым текстом.
 * Комментарий или анонс не должен теряться из-за картинки.
 */
async function sendRichOrText(
  settings: TelegramSettings,
  messageThreadId: number,
  blocks: unknown[],
  opts: { replyToMessageId?: number; fallbackText: string },
): Promise<number | null> {
  const attempt = async (payload: unknown[], note: string, media?: UploadedFile[]): Promise<number | null> => {
    try {
      const sent = media && media.length > 0
        ? await sendRichMessageWithFiles(settings.botToken, {
            chatId: settings.chatId,
            messageThreadId,
            richMessage: { blocks: payload },
            media,
            replyToMessageId: opts.replyToMessageId,
          })
        : await sendRichMessage(settings.botToken, {
            chatId: settings.chatId,
            messageThreadId,
            richMessage: { blocks: payload },
            replyToMessageId: opts.replyToMessageId,
          });
      return sent.message_id ?? null;
    } catch (error) {
      logMirrorError(note, error);
      return null;
    }
  };

  const { blocks: uploaded, media } = await attachBlockImages(blocks);
  if (media.length > 0) {
    const sent = await attempt(uploaded, "не удалось отправить с залитыми картинками", media);
    if (sent) return sent;
  }

  const sent = await attempt(blocks, "«богатое» сообщение не принято");
  if (sent) return sent;

  const withoutMedia = blocks.filter((block) => !MEDIA_BLOCKS.has(blockType(block)));
  if (withoutMedia.length !== blocks.length) {
    const retried = await attempt(withoutMedia, "«богатое» сообщение с картинками не принято, пробуем без них");
    if (retried) return retried;
  }
  try {
    const sent = await sendMessage(settings.botToken, {
      chatId: settings.chatId,
      messageThreadId,
      text: opts.fallbackText.slice(0, 4000),
      replyToMessageId: opts.replyToMessageId,
    });
    return sent.message_id ?? null;
  } catch (fallbackError) {
    logMirrorError("не удалось отправить сообщение даже текстом", fallbackError);
    return null;
  }
}

function blockType(block: unknown): string {
  if (!block || typeof block !== "object") return "";
  return String((block as { type?: unknown }).type ?? "");
}

/** Блоки с вложениями — их и убираем при второй попытке. */
const MEDIA_BLOCKS = new Set(["photo", "video", "animation", "audio", "document", "voice_note", "collage", "slideshow", "map"]);

/** Новый топик сайта → тема в обсуждении. */
export function mirrorTopicToTelegram(topicId: number): void {
  if (!mirrorEnabled) return;
  void (async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured || !settings.mirrorNewTopics) return;
      if (await getThreadForTopic(topicId)) return;
      await withTopicLock(topicId, () => ensureThread(topicId, settings));
    } catch (error) {
      logMirrorError(`не удалось зеркалировать топик ${topicId}`, error);
    }
  })();
}

/** Ручное создание темы для уже существующего топика (кнопка на странице). */
export async function createTelegramThreadForTopic(topicId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const settings = await readTelegramSettings();
    if (!settings.configured) return { ok: false, error: "Интеграция с Telegram не настроена." };
    const thread = await withTopicLock(topicId, () => ensureThread(topicId, settings));
    return thread ? { ok: true } : { ok: false, error: "Топик не найден." };
  } catch (error) {
    logMirrorError(`не удалось создать тему для топика ${topicId}`, error);
    return { ok: false, error: (error as Error)?.message ?? "Ошибка Telegram" };
  }
}

/** Заголовок топика изменился — переименовываем тему в чате. */
export function mirrorTopicRenameToTelegram(topicId: number): void {
  void (async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured) return;
      const thread = await getThreadForTopic(topicId);
      if (!thread) return;
      const topic = await loadTopic(topicId);
      if (!topic) return;
      const name = topicName(topicId, topic.title);
      if (name === thread.threadName) return;
      await editForumTopicName(settings.botToken, String(thread.chatId), thread.messageThreadId, name);
      await getDrizzle().update(tgThreads).set({ threadName: name }).where(eq(tgThreads.topicId, topicId));
    } catch (error) {
      logMirrorError(`не удалось переименовать тему топика ${topicId}`, error);
    }
  })();
}

/** Удаление топика на сайте → удаление темы в чате (привязка исчезнет по внешнему ключу). */
export function mirrorTopicDeletedToTelegram(topicId: number, thread?: TgThread | null): void {
  enqueue(async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured) return;
      // Тему чата удаляем до топика: привязка живёт по внешнему ключу, поэтому
      // удаляющий код передаёт её сюда заранее. Без аргумента читаем сами —
      // это путь, где топик на сайте ещё существует.
      const target = thread ?? (await getThreadForTopic(topicId));
      if (!target) return;
      await deleteForumTopic(settings.botToken, String(target.chatId), target.messageThreadId);
      console.log(`[tg] удалена тема топика ${topicId}`);
    } catch (error) {
      logMirrorError(`не удалось удалить тему топика ${topicId}`, error);
    }
  });
}

/** Комментарий на сайте → сообщение в теме чата. */
export function mirrorCommentToTelegram(commentId: number): void {
  if (!mirrorEnabled) return;
  enqueue(async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured) return;
      if (await getCommentLink(commentId)) return;
      const comment = await loadComment(commentId);
      if (!comment) return;
      const thread = await withTopicLock(comment.topicId, () => ensureThread(comment.topicId, settings));
      if (!thread) return;

      const parentMessageId = comment.parentId ? (await getCommentLink(comment.parentId))?.messageId ?? null : null;
      const messageId = await sendComment(settings, thread, comment, parentMessageId);
      if (messageId) {
        await linkComment(commentId, thread.chatId, messageId, null);
        console.log(`[tg] комментарий ${commentId} отправлен в тему ${thread.messageThreadId} (message_id=${messageId})`);
      }
    } catch (error) {
      logMirrorError(`не удалось зеркалировать комментарий ${commentId}`, error);
    }
  });
}

/** Правка комментария на сайте → правка сообщения в чате. */
export function mirrorCommentEditedToTelegram(commentId: number): void {
  void (async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured) return;
      const link = await getCommentLink(commentId);
      if (!link) return;
      const comment = await loadComment(commentId);
      if (!comment) return;
      const blocks = commentBlocks(comment);
      const chatId = String(link.chatId);
      const edit = async (payload: unknown[], note: string): Promise<boolean> => {
        try {
          await editRichMessage(settings.botToken, { chatId, messageId: link.messageId, richMessage: { blocks: payload } });
          return true;
        } catch (error) {
          logMirrorError(note, error);
          return false;
        }
      };

      // Правка не может принести новые картинки, поэтому если Bot API не
      // принимает адреса, оставляем сообщение с прежними вложениями.
      if (await edit(blocks, "правка «богатым» сообщением не принята")) return;
      const withoutMedia = blocks.filter((block) => !MEDIA_BLOCKS.has(blockType(block)));
      if (withoutMedia.length !== blocks.length && (await edit(withoutMedia, "правка с картинками не принята, оставляем без них"))) return;
      // Посний вариант — обычный текст: прежние вложения чат сохраняет.
      try {
        await editMessageText(settings.botToken, { chatId, messageId: link.messageId, text: richBlocksToPlainText(blocks) });
      } catch (error) {
        logMirrorError("не удалось изменить сообщение комментария", error);
      }
    } catch (error) {
      logMirrorError(`не удалось изменить сообщение комментария ${commentId}`, error);
    }
  })();
}

/** Удаление или скрытие комментария на сайте → удаление сообщения из чата. */
export function mirrorCommentDeletedToTelegram(commentId: number, link?: TgCommentLink | null): void {
  enqueue(async () => {
    try {
      const settings = await readTelegramSettings();
      if (!settings.configured) return;
      // Сообщение удаляем, пока привязка ещё существует: удаляющий код читает
      // её до удаления комментария и передаёт сюда, иначе внешний ключ уносит
      // связь вместе со строкой. Без аргумента читаем сами — это путь скрытия,
      // где комментарий на сайте остаётся.
      const target = link ?? (await getCommentLink(commentId));
      if (!target) return;
      await deleteMessage(settings.botToken, String(target.chatId), target.messageId);
      await forgetCommentLink(commentId);
      console.log(`[tg] сообщение комментария ${commentId} удалено из чата`);
    } catch (error) {
      logMirrorError(`не удалось удалить сообщение комментария ${commentId}`, error);
    }
  });
}

/** Отвязка темы вручную: связь с топиком теряется, тема удаляется из чата. */
export async function unlinkTelegramThread(topicId: number): Promise<boolean> {
  try {
    const thread = await forgetThread(topicId);
    if (!thread) return false;
    const settings = await readTelegramSettings();
    if (settings.configured) {
      try {
        await deleteForumTopic(settings.botToken, String(thread.chatId), thread.messageThreadId);
      } catch (error) {
        logMirrorError(`не удалось удалить тему топика ${topicId}`, error);
      }
    }
    return true;
  } catch (error) {
    logMirrorError(`не удалось отвязать тему топика ${topicId}`, error);
    return false;
  }
}

/* ── Сборка сообщений ── */

function commentBlocks(comment: CommentInfo): unknown[] {
  const head = { type: "paragraph", text: `${comment.authorName} · ${formatDate(comment.createdAt)}` };
  const body = toInputRichBlocks(htmlToRichBlocks(comment.body ?? "", siteUrlResolver()));
  const footer = {
    type: "buttons",
    buttons: [{ text: "Ответить на сайте", url: commentUrl(comment) }],
  };
  return [head, ...body, footer];
}
async function sendComment(
  settings: TelegramSettings,
  thread: TgThread,
  comment: CommentInfo,
  parentMessageId: number | null,
): Promise<number | null> {
  const blocks = commentBlocks(comment);
  return sendRichOrText(settings, thread.messageThreadId, blocks, {
    replyToMessageId: parentMessageId ?? undefined,
    fallbackText: `${comment.authorName}: ${richBlocksToPlainText(blocks).slice(0, 3500)}\n${commentUrl(comment)}`,
  });
}
