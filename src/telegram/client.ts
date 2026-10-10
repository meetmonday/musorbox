import { config } from "../core/config";

/* ── Типы Bot API, которые использует интеграция ── */

export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TgMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TgUser;
  language?: string;
};

export type TgMessage = {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: true;
  chat?: { id: number; type?: string; username?: string; title?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  /** Структурированное «богатое» сообщение (Bot API 10.x). */
  rich_message?: unknown;
  reply_to_message?: TgMessage;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  animation?: TgDocument;
  video?: TgDocument;
  /** Голосовое, стикер, опрос и прочее в комментарии не участвует. */
  sticker?: unknown;
  via_bot?: TgUser;
  /** Служебные сообщения (вступление, закрепление и т.п.) — не комментарии. */
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  forum_topic_created?: unknown;
  forum_topic_closed?: unknown;
  forum_topic_reopened?: unknown;
};

export type TgPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TgDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
};

export type TgForumTopic = {
  message_thread_id: number;
  name?: string;
};

/** Тело `rich_message`: блоки, HTML- или Markdown-разметка, медиа. */
export type TgRichMessage = {
  blocks?: unknown[];
  html?: string;
  markdown?: string;
  media?: unknown[];
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
};

export type TgChatInfo = {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
};

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Telegram ${method}: ${code} ${description}`);
    this.name = "TelegramApiError";
  }
}

const TIMEOUT_MS = 20_000;

/** Файл, который отправляем боту в multipart-запросе. */
export type UploadedFile = {
  /** Имя поля формы, на него ссылается `attach://` внутри rich_message. */
  name: string;
  bytes: Uint8Array;
  filename: string;
};

type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

/** Тело запроса к Bot API: JSON-строка или форма с файлами. */
type TelegramBody = string | FormData;

async function callTelegramRaw<T = unknown>(token: string, method: string, body: TelegramBody): Promise<T> {
  const url = `${config.telegram.apiBase}/bot${token}/${method}`;
  const res = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let parsed: TgResponse<T>;
  try {
    parsed = JSON.parse(text) as TgResponse<T>;
  } catch {
    throw new TelegramApiError(method, res.status, `не разобран ответ: ${text.slice(0, 200)}`);
  }
  if (!parsed.ok) {
    throw new TelegramApiError(method, parsed.error_code ?? res.status, parsed.description ?? "неизвестная ошибка");
  }
  return parsed.result;
}

/** Вызов метода Bot API. Ошибка уровня API превращается в исключение. */
export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return callTelegramRaw<T>(token, method, JSON.stringify(payload));
}

/**
 * «Богатое» сообщение с вложениями, залитыми напрямую: картинки идут полями
 * формы, а в блоках на них ссылается `attach://<имя>`. Так сообщение не зависит
 * от того, дотянулся ли Telegram до сайта за файлом.
 */
export async function sendRichMessageWithFiles(
  token: string,
  params: {
    chatId: string;
    messageThreadId?: number;
    richMessage: TgRichMessage;
    media: UploadedFile[];
    replyToMessageId?: number;
  },
): Promise<TgMessage> {
  const form = new FormData();
  form.set("chat_id", params.chatId);
  if (params.messageThreadId) form.set("message_thread_id", String(params.messageThreadId));
  if (params.replyToMessageId) form.set("reply_parameters", JSON.stringify({ message_id: params.replyToMessageId }));
  form.set("rich_message", JSON.stringify(params.richMessage));
  for (const file of params.media) {
    form.set(file.name, new Blob([file.bytes]), file.filename);
  }
  return callTelegramRaw<TgMessage>(token, "sendRichMessage", form);
}

/* ── Методы, которые нужны интеграции ── */

export function getMe(token: string): Promise<{ id: number; username?: string; first_name?: string }> {
  return callTelegram(token, "getMe");
}

export function getChat(token: string, chatId: string): Promise<TgChatInfo> {
  return callTelegram(token, "getChat", { chat_id: chatId });
}

export type TgProfilePhotos = {
  total_count: number;
  photos: Array<Array<{ file_id: string; file_unique_id: string; width: number; height: number }>>;
};

export function getUserProfilePhotos(token: string, userId: number, limit = 1): Promise<TgProfilePhotos> {
  return callTelegram(token, "getUserProfilePhotos", { user_id: userId, limit });
}

export type TgFile = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
};

export function getFile(token: string, fileId: string): Promise<TgFile> {
  return callTelegram(token, "getFile", { file_id: fileId });
}

/** Прямая ссылка на файл бота: сюда же качаем аватары собеседников. */
export function fileUrl(token: string, filePath: string): string {
  return `${config.telegram.apiBase}/file/bot${token}/${filePath}`;
}

/** Создаёт тему в обсуждении. Боту нужны права администратора с управлением темами. */
export function createForumTopic(token: string, chatId: string, name: string, iconColor?: number): Promise<TgForumTopic> {
  return callTelegram(token, "createForumTopic", { chat_id: chatId, name, ...(iconColor ? { icon_color: iconColor } : {}) });
}

export function deleteForumTopic(token: string, chatId: string, messageThreadId: number): Promise<true> {
  return callTelegram(token, "deleteForumTopic", { chat_id: chatId, message_thread_id: messageThreadId });
}

export function editForumTopicName(token: string, chatId: string, messageThreadId: number, name: string): Promise<true> {
  return callTelegram(token, "editForumTopic", { chat_id: chatId, message_thread_id: messageThreadId, name });
}

export function sendRichMessage(
  token: string,
  params: {
    chatId: string;
    messageThreadId?: number;
    richMessage: TgRichMessage;
    replyToMessageId?: number;
  },
): Promise<TgMessage> {
  const payload: Record<string, unknown> = {
    chat_id: params.chatId,
    rich_message: params.richMessage,
  };
  if (params.messageThreadId) payload.message_thread_id = params.messageThreadId;
  if (params.replyToMessageId) payload.reply_parameters = { message_id: params.replyToMessageId };
  return callTelegram<TgMessage>(token, "sendRichMessage", payload);
}

/** Обычное сообщение: запасной вариант, если «богатое» не принимается. */
export function sendMessage(
  token: string,
  params: { chatId: string; messageThreadId?: number; text: string; replyToMessageId?: number },
): Promise<TgMessage> {
  const payload: Record<string, unknown> = { chat_id: params.chatId, text: params.text };
  if (params.messageThreadId) payload.message_thread_id = params.messageThreadId;
  if (params.replyToMessageId) payload.reply_parameters = { message_id: params.replyToMessageId };
  return callTelegram<TgMessage>(token, "sendMessage", payload);
}

export function editRichMessage(
  token: string,
  params: { chatId: string; messageId: number; richMessage: TgRichMessage },
): Promise<TgMessage | true> {
  return callTelegram(token, "editMessageText", {
    chat_id: params.chatId,
    message_id: params.messageId,
    rich_message: params.richMessage,
  });
}

export function editMessageText(
  token: string,
  params: { chatId: string; messageId: number; text: string },
): Promise<TgMessage | true> {
  return callTelegram(token, "editMessageText", {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text,
  });
}

export function deleteMessage(token: string, chatId: string, messageId: number): Promise<true> {
  return callTelegram(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

export function setWebhook(
  token: string,
  url: string,
  secretToken: string,
  allowedUpdates: string[],
): Promise<true> {
  return callTelegram(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: allowedUpdates,
    drop_pending_updates: false,
  });
}

export function deleteWebhook(token: string): Promise<true> {
  return callTelegram(token, "deleteWebhook");
}

export function getWebhookInfo(token: string): Promise<Record<string, unknown>> {
  return callTelegram(token, "getWebhookInfo");
}
