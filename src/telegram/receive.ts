import { eq } from "drizzle-orm";
import { getDrizzle } from "../core/db";
import { comments } from "../core/schema";
import { addComment, deleteComment, getCommentChildrenCount } from "../comments/service";
import { sanitizeHtml, stripTags, firstImageSrc } from "../core/utils";
import type { TgMessage, TgUpdate, TgUser } from "./client";
import { telegramMessageToHtml } from "./format";
import { readTelegramSettings } from "./settings";
import { extractStoredImages, imagesHtml, materializeTelegramImages } from "./media";
import {
  findCommentIdForMessage,
  findTopicIdForThread,
  findTgCommentForMessage,
  linkComment,
  resolveTelegramAuthor,
  setCommentBody,
  withKeyLock,
} from "./service";

/**
 * Входящее зеркалирование: сообщение в теме обсуждения становится комментарием
 * на сайте. Автору заводится «теневой» профиль, ответы сохраняют структуру
 * ветки, повторная доставка апдейта дублей не создаёт.
 */

const MAX_BODY = 4000;

/** Служебные сообщения обсуждением не считаются. */
function isServiceMessage(message: TgMessage): boolean {
  return Boolean(
    message.new_chat_members ||
      message.left_chat_member ||
      message.forum_topic_created ||
      message.forum_topic_closed ||
      message.forum_topic_reopened ||
      message.via_bot,
  );
}

function sameChat(chatId: unknown, expected: string): boolean {
  return typeof chatId === "number" && String(chatId) === expected.trim();
}

/** Тело сообщения в HTML сайта: текст с разметкой + картинки из чата. */
async function messageBody(token: string, message: TgMessage): Promise<string> {
  const html = telegramMessageToHtml(message);
  const images = imagesHtml(await materializeTelegramImages(token, message));
  return truncateHtml(sanitizeHtml(joinBody(html, images)));
}

/**
 * Обрезка по лимиту Bot API: на срезе может остаться незакрытый тег, который
 * показался бы в теле комментария обычным текстом.
 */
function truncateHtml(html: string): string {
  return html.slice(0, MAX_BODY).replace(/<[^>]*$/, "");
}

/** Текст и картинки: разделитель нужен только когда есть и то, и другое. */
function joinBody(html: string, images: string): string {
  const text = html.trim();
  if (text && images) return `${text}<br clear="all"/>\n${images}`;
  return text || images;
}

async function belongsToTopic(commentId: number, topicId: number): Promise<boolean> {
  const rows = await getDrizzle()
    .select({ topicId: comments.topicId })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  return rows[0]?.topicId === topicId;
}

async function importMessage(
  message: TgMessage,
  author: TgUser,
  topicId: number,
  chatId: number,
  botToken: string,
): Promise<void> {
  const body = await messageBody(botToken, message);
  // Пустое сообщение (без текста и без картинок) комментарием не становится.
  if (!stripTags(body) && !firstImageSrc(body)) return;

  // Ответ на сообщение бота в теме → родительский комментарий на сайте.
  const replyTo = message.reply_to_message;
  const parentId = replyTo?.message_id ? await findCommentIdForMessage(chatId, replyTo.message_id) : null;
  const parent = parentId && (await belongsToTopic(parentId, topicId)) ? parentId : null;

  const userId = await resolveTelegramAuthor(botToken, author);
  if (!userId) {
    console.error(`[tg] не удалось завести профиль для tg:${author.id}`);
    return;
  }

  const commentId = await addComment({
    topicId,
    parentId: parent,
    body,
    authorId: userId,
    // Комментарий пришёл из чата — обратно в чат не дублируем и не федерацируем.
    mirrorTelegram: false,
    federate: false,
  });
  if (!commentId) return;
  await linkComment(commentId, chatId, message.message_id, author.id);
  console.log(`[tg] сообщение ${message.message_id} → комментарий ${commentId} топика ${topicId} (tg:${author.id})`);
}

async function applyEdit(message: TgMessage): Promise<void> {
  const chatId = Number(message.chat?.id);
  const commentId = await findCommentIdForMessage(chatId, message.message_id);
  if (!commentId) return;
  // Медиа в Telegram при правке не меняется: картинки берём из комментария,
  // иначе каждое исправление текста плодило бы копии файлов.
  const stored = extractStoredImages((await commentBody(commentId)) ?? "");
  const body = truncateHtml(sanitizeHtml(joinBody(telegramMessageToHtml(message), imagesHtml(stored))));
  if (!stripTags(body) && !firstImageSrc(body)) return;
  await setCommentBody(commentId, body);
  console.log(`[tg] правка сообщения ${message.message_id} → комментарий ${commentId}`);
}

/** Текущее тело комментария — нужно, чтобы сохранить скачанные картинки. */
async function commentBody(commentId: number): Promise<string | null> {
  const rows = await getDrizzle().select({ body: comments.body }).from(comments).where(eq(comments.id, commentId)).limit(1);
  return rows[0]?.body ?? null;
}

/**
 * Боты не получают апдейтов об удалении сообщений в группе (Bot API присылает
 * `deleted_business_messages` только для бизнес-аккаунтов), поэтому автор
 * убирает свой комментарий с сайта командой-ответом на своё же сообщение.
 */
const DELETE_COMMANDS = new Set(["/del", "/delete", "/удалить", "удалить", "#удалить"]);

function isDeleteCommand(message: TgMessage): boolean {
  const text = (message.text ?? "").trim().toLowerCase();
  return DELETE_COMMANDS.has(text);
}

async function applyDeleteCommand(message: TgMessage, author: TgUser, chatId: number): Promise<boolean> {
  const replied = message.reply_to_message;
  if (!replied?.message_id) return false;
  const found = await findTgCommentForMessage(chatId, replied.message_id);
  // Удалять можно только свой комментарий.
  if (!found || found.tgUserId !== author.id) return false;
  // Как и в веб-интерфейсе: на комментарий с ответами удаление не действует,
  // иначе из-за внешнего ключа с сайта ушла бы вся ветка.
  if ((await getCommentChildrenCount(found.commentId)) > 0) {
    console.log(`[tg] команда удаления отклонена: на комментарий ${found.commentId} уже ответили`);
    return false;
  }
  await deleteComment(found.commentId, found.topicId);
  console.log(`[tg] команда удаления: комментарий ${found.commentId} убран с сайта (tg:${author.id})`);
  return true;
}

/** Разбор одного апдейта Telegram. Ошибки гасятся: Telegram ждёт быстрый ответ. */
export async function handleTelegramUpdate(update: TgUpdate): Promise<void> {
  const message = update.message ?? update.edited_message;
  if (!message || isServiceMessage(message)) return;
  const from = message.from;
  if (!from || from.is_bot) return;

  try {
    const settings = await readTelegramSettings();
    if (!settings.configured) return;
    if (!sameChat(message.chat?.id, settings.chatId)) return;

    const chatId = Number(message.chat?.id);
    if (update.edited_message !== undefined) {
      await applyEdit(message);
      return;
    }
    // Telegram повторяет доставку, пока не получит 200: сообщение, которое уже
    // стало комментарием, второй раз комментарием не становится. Повтор,
    // пришедший, пока первый импорт ещё качает картинки, ждёт его: связь
    // появляется только в конце импорта, и без очереди проверка ниже ничего не
    // нашла бы — комментарий создался бы дважды.
    await withKeyLock(`import:${chatId}:${message.message_id}`, async () => {
      if (await findCommentIdForMessage(chatId, message.message_id)) {
        await applyEdit(message);
        return;
      }
      const topicId = message.message_thread_id ? await findTopicIdForThread(chatId, message.message_thread_id) : null;
      if (!topicId) return;
      if (isDeleteCommand(message)) {
        // Команда удаления никогда не становится комментарием, даже если её
        // прислал не автор: иначе в обсуждении появится "/del".
        await applyDeleteCommand(message, from, chatId);
        return;
      }
      await importMessage(message, from, topicId, chatId, settings.botToken);
    });
  } catch (error) {
    console.error("[tg] ошибка разбора апдейта:", (error as Error)?.message ?? error);
  }
}
