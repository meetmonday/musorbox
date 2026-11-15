import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { eq } from "drizzle-orm";
import { config } from "../core/config";
import { getDrizzle } from "../core/db";
import { categories, comments, tags } from "../core/schema";
import { isStaff } from "../core/middleware";
import type { SessionUser, UserContext } from "../core/middleware";
import { firstImageSrc, sanitizeHtml, slugify, stripTags } from "../core/utils";
import {
  createTopic, deleteTopic, getEditableCategories, getTopicById,
  getTopicsByCategory, searchTopics, uniqueSlug, updateTopic,
} from "../topics/service";
import type { TopicDetail } from "../topics/service";
import {
  addComment, deleteComment, getCommentById, getCommentChildrenCount,
  getComments, updateComment,
} from "../comments/service";
import type { TopicComment } from "../comments/service";
import { getForumTags } from "../forum/service";
import { castVote } from "../votes/service";
import { authenticateCredentials } from "../auth/service";
import { authenticateApiToken, issueAppToken, revokeAppToken } from "./tokens";
import {
  countUnreadMessages,
  getMessageThread,
  getMessageUpdates,
  listConversations,
  searchMessageUsers,
  sendPrivateMessage,
} from "../messages/service";
import {
  addGroupMember,
  createGroupChat,
  deleteGroup,
  getGroupThread,
  getGroupUpdates,
  joinGroupByInvite,
  leaveGroup,
  listGroupConversations,
  removeGroupMember,
  resetGroupInvite,
  sendGroupMessage,
} from "../messages/group-service";
import type { GroupThread } from "../messages/group-service";
import { canOpenMessageStream, subscribeToMessageEvents } from "../messages/realtime";
import {
  cleanupMessageImages,
  MAX_MESSAGE_IMAGES_TOTAL_BYTES,
  MessageImageError,
  openMessageImage,
  prepareMessageImages,
} from "../messages/media";
import type { PreparedMessageImage } from "../messages/media";

type ApiContext = Context<{ Variables: UserContext }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429;

class ApiError extends Error {
  constructor(public readonly status: ErrorStatus, message: string) {
    super(message);
  }
}

const app = new Hono<{ Variables: UserContext }>({ strict: false });

const MAX_LOGIN_IPS = 10_000;
const loginAttempts = new Map<string, { time: number; count: number }>();

function clientIp(c: ApiContext): string {
  return c.req.header("x-real-ip")
    || c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  if (loginAttempts.size >= MAX_LOGIN_IPS) {
    for (const [key, value] of loginAttempts) {
      if (now - value.time > 60_000) loginAttempts.delete(key);
    }
    if (loginAttempts.size >= MAX_LOGIN_IPS) loginAttempts.clear();
  }
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.time > 60_000) {
    loginAttempts.set(ip, { time: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

app.onError((error, c) => {
  if (error instanceof ApiError) {
    if (error.status === 401) c.header("WWW-Authenticate", "Bearer");
    return c.json({ ok: false, error: error.message }, error.status);
  }
  console.error("Ошибка публичного API:", error);
  return c.json({ ok: false, error: "Внутренняя ошибка сервера." }, 500);
});

app.use("/api/*", async (c, next) => {
  // Сессия сайта не предоставляет доступ к API, даже при наличии cookie.
  c.set("user", undefined);
  c.header("Cache-Control", "no-store");
  const authorization = c.req.header("Authorization");
  if (authorization !== undefined) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) throw new ApiError(401, "Нужен заголовок Authorization: Bearer <токен>.");
    const user = await authenticateApiToken(match[1]!);
    if (!user) throw new ApiError(401, "Недействительный API-токен.");
    if (user.banned) throw new ApiError(403, "Аккаунт заблокирован.");
    c.set("user", user);
  }
  const credentialLogin = c.req.method === "POST" && c.req.path === "/api/auth/login";
  if (!credentialLogin && c.req.method !== "GET" && c.req.method !== "HEAD") requireUser(c);
  await next();
});

function requireUser(c: ApiContext): SessionUser {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "Для этого действия нужен API-токен.");
  return user;
}

function requestBearerToken(c: ApiContext): string {
  const match = /^Bearer ([^\s]+)$/i.exec(c.req.header("Authorization") ?? "");
  if (!match) throw new ApiError(401, "Нужен заголовок Authorization: Bearer <токен>.");
  return match[1]!;
}

function positiveId(value: unknown, name = "id"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, `${name}: требуется положительное целое число.`);
  }
  return value;
}

function routeId(c: ApiContext): number {
  const value = c.req.param("id");
  if (!value || !/^[1-9]\d*$/.test(value)) throw new ApiError(400, "Некорректный id.");
  return positiveId(Number(value));
}

async function jsonObject(c: ApiContext, fields: string[]): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")) {
    throw new ApiError(415, "Нужен Content-Type: application/json.");
  }
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new ApiError(400, "Некорректный JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Тело запроса должно быть JSON-объектом.");
  }
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw new ApiError(400, "Неизвестное поле в JSON-объекте.");
  }
  return value as Record<string, unknown>;
}

type MessageInput = { body: string; images: PreparedMessageImage[] };

async function messageInput(c: ApiContext): Promise<MessageInput> {
  const contentType = c.req.header("Content-Type") ?? "";
  if (/^application\/json(?:\s*;|$)/i.test(contentType)) {
    const data = await jsonObject(c, ["body"]);
    if (typeof data.body !== "string") throw new ApiError(400, "body: требуется строка.");
    return { body: data.body, images: [] };
  }
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) {
    throw new ApiError(415, "Нужен Content-Type: application/json или multipart/form-data.");
  }
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_MESSAGE_IMAGES_TOTAL_BYTES + 1024 * 1024) {
    throw new ApiError(413, "Общий размер изображений не должен превышать 50 МиБ.");
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new ApiError(400, "Некорректное multipart-тело.");
  }
  for (const key of new Set(form.keys())) {
    if (key !== "body" && key !== "images") throw new ApiError(400, `Неизвестное multipart-поле: ${key}.`);
  }
  const bodyValue = form.get("body");
  if (bodyValue !== null && typeof bodyValue !== "string") {
    throw new ApiError(400, "body: требуется строка.");
  }
  const imageValues = form.getAll("images");
  if (imageValues.some((value) => !(value instanceof File))) {
    throw new ApiError(400, "images: требуются файлы изображений.");
  }
  try {
    return {
      body: bodyValue ?? "",
      images: await prepareMessageImages(imageValues as File[]),
    };
  } catch (error) {
    if (error instanceof MessageImageError) throw new ApiError(error.status, error.message);
    throw error;
  }
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string") throw new ApiError(400, `${name}: требуется строка.`);
  const result = value.trim();
  if (!result || result.length > maxLength) {
    throw new ApiError(400, `${name}: длина должна быть от 1 до ${maxLength} символов.`);
  }
  return result;
}

async function visibleTopic(id: number): Promise<TopicDetail> {
  const topic = await getTopicById(id);
  if (!topic || topic.hidden) {
    throw new ApiError(404, "Топик не найден.");
  }
  return topic;
}

async function visibleComment(id: number): Promise<TopicComment> {
  const comment = await getCommentById(id);
  if (!comment) throw new ApiError(404, "Комментарий не найден.");
  await visibleTopic(comment.topicId);
  if (comment.hidden) throw new ApiError(404, "Комментарий не найден.");
  const seen = new Set([comment.id]);
  let parentId = comment.parentId;
  while (parentId !== null) {
    if (seen.has(parentId)) throw new ApiError(404, "Комментарий не найден.");
    seen.add(parentId);
    const [parent] = await getDrizzle().select({
      parentId: comments.parentId, topicId: comments.topicId, hidden: comments.hidden,
    }).from(comments).where(eq(comments.id, parentId)).limit(1);
    if (!parent || parent.hidden || parent.topicId !== comment.topicId) {
      throw new ApiError(404, "Комментарий не найден.");
    }
    parentId = parent.parentId;
  }
  return comment;
}

function editableTopic(topic: TopicDetail, user: SessionUser): void {
  if (topic.authorId !== user.id && !isStaff(user)) {
    throw new ApiError(403, "Редактировать и удалять топик может только автор или редактор.");
  }
}

async function topicInput(data: Record<string, unknown>, previous?: TopicDetail) {
  if (previous && Object.keys(data).length === 0) throw new ApiError(400, "Укажите поля для изменения.");
  const title = data.title === undefined && previous ? previous.title : text(data.title, "title", 200);
  let body = previous?.body ?? "";
  if (data.body !== undefined || !previous) {
    if (typeof data.body !== "string") throw new ApiError(400, "body: требуется строка HTML.");
    body = sanitizeHtml(data.body.trim());
    if ((!stripTags(body) && !firstImageSrc(body)) || body.length > 200_000) {
      throw new ApiError(400, "Текст топика не может быть пустым или длиннее 200000 символов.");
    }
  }
  const categoryId = data.categoryId === undefined && previous
    ? previous.categoryId : positiveId(data.categoryId, "categoryId");
  const editable = await getEditableCategories();
  if (!editable.some((category) => category.id === categoryId)) {
    throw new ApiError(400, "Выберите доступный раздел (не index).");
  }
  let tagIds = previous?.tags.map((tag) => tag.id) ?? [];
  if (data.tagIds !== undefined) {
    if (!Array.isArray(data.tagIds) || data.tagIds.length > 10) {
      throw new ApiError(400, "tagIds: нужен массив не более чем из 10 идентификаторов.");
    }
    tagIds = data.tagIds.map((id) => positiveId(id, "tagIds"));
    const { os, quest } = await getForumTags();
    const allowed = new Set([...os, ...quest].map((tag) => tag.id));
    if (tagIds.some((id) => !allowed.has(id))) {
      throw new ApiError(400, "Можно выбирать только существующие теги групп os и quest.");
    }
    tagIds = [...new Set(tagIds)];
  }
  return { title, body, categoryId, tagIds, leadImage: firstImageSrc(body) };
}

function commentBody(value: unknown): string {
  const body = sanitizeHtml(text(value, "body", 4000));
  if (!body.trim()) throw new ApiError(400, "Текст комментария не может быть пустым.");
  if (body.length > 4000) throw new ApiError(400, "Текст комментария слишком большой.");
  return body;
}

function nonNegativeQuery(c: ApiContext, name: string, fallback: number = 0): number {
  const raw = c.req.query(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new ApiError(400, `${name}: требуется целое число не меньше нуля.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ApiError(400, `${name}: слишком большое число.`);
  return value;
}

function optionalPositiveQuery(c: ApiContext, name: string): number | undefined {
  const raw = c.req.query(name);
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new ApiError(400, `${name}: требуется положительное целое число.`);
  return positiveId(Number(raw), name);
}

function inviteUrl(token: string): string {
  return new URL(`/messages/groups/join/${token}`, config.baseUrl).toString();
}

function apiGroupThread(thread: GroupThread) {
  const { inviteToken, ...group } = thread.group;
  return { ...thread, group: { ...group, inviteUrl: inviteUrl(inviteToken) } };
}

function serviceError(result: { ok: false; error: string; status: 400 | 403 | 404 | 429 }): never {
  throw new ApiError(result.status, result.error);
}

app.post("/api/auth/login", async (c) => {
  if (loginRateLimited(clientIp(c))) {
    c.header("Retry-After", "60");
    throw new ApiError(429, "Слишком много попыток входа. Подождите минуту.");
  }
  const data = await jsonObject(c, ["username", "password"]);
  if (typeof data.username !== "string" || data.username.trim().length < 1 || data.username.trim().length > 32) {
    throw new ApiError(400, "username: требуется строка от 1 до 32 символов.");
  }
  if (typeof data.password !== "string" || data.password.length < 1 || data.password.length > 1024) {
    throw new ApiError(400, "password: требуется непустая строка не длиннее 1024 символов.");
  }
  const result = await authenticateCredentials(data.username, data.password);
  if (!result.ok) throw new ApiError(401, result.error);
  const token = await issueAppToken(result.userId, "Musorgram");
  return c.json({ ok: true, token, tokenType: "Bearer" }, 201);
});

app.delete("/api/auth/token", async (c) => {
  requireUser(c);
  await revokeAppToken(requestBearerToken(c));
  return c.json({ ok: true });
});

app.get("/api/me", (c) => {
  const user = requireUser(c);
  return c.json({ ok: true, user: {
    id: user.id, username: user.username, role: user.role, avatarUrl: user.avatarUrl,
    banned: user.banned, unreadCount: user.unreadCount, unreadMessagesCount: user.unreadMessagesCount,
  } });
});

app.get("/api/messages/events", (c) => {
  const user = requireUser(c);
  if (!canOpenMessageStream(user.id)) throw new ApiError(429, "Слишком много открытых realtime-соединений.");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    const queue: Array<{ type: "message" | "read"; peerId?: number; groupId?: number; messageId?: number }> = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribeToMessageEvents(user.id, (event) => {
      if (queue.length < 100) queue.push(event);
      const resume = wake;
      wake = null;
      resume?.();
    });
    stream.onAbort(() => {
      unsubscribe();
      const resume = wake;
      wake = null;
      resume?.();
    });
    await stream.writeSSE({ event: "ready", data: "{}", retry: 2000 });
    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timeout);
              if (wake === finish) wake = null;
              resolve();
            };
            const timeout = setTimeout(finish, 15_000);
            wake = finish;
          });
        }
        if (stream.aborted) break;
        const event = queue.shift();
        if (event) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
            id: String(event.messageId ?? Date.now()),
          });
        } else {
          await stream.writeSSE({ event: "ping", data: String(Date.now()) });
        }
      }
    } finally {
      unsubscribe();
    }
  });
});

app.get("/api/messages", async (c) => {
  const user = requireUser(c);
  const limit = optionalPositiveQuery(c, "limit") ?? 50;
  if (limit > 100) throw new ApiError(400, "limit должен быть не больше 100.");
  const [direct, groups, unreadCount] = await Promise.all([
    listConversations(user.id, 100),
    listGroupConversations(user.id, 100),
    countUnreadMessages(user.id),
  ]);
  const items = [...direct, ...groups]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit);
  return c.json({ ok: true, items, unreadCount });
});

app.get("/api/messages/users", async (c) => {
  const user = requireUser(c);
  const q = text(c.req.query("q"), "q", 32);
  const limit = optionalPositiveQuery(c, "limit") ?? 20;
  if (limit > 30) throw new ApiError(400, "limit должен быть не больше 30.");
  return c.json({ ok: true, items: await searchMessageUsers(user.id, q, limit) });
});

app.get("/api/messages/media/:id", async (c) => {
  const user = requireUser(c);
  const size = c.req.query("size");
  if (size !== undefined && size !== "thumb") throw new ApiError(400, "size: поддерживается только thumb.");
  const media = await openMessageImage(routeId(c), user.id, size === "thumb");
  if (!media) throw new ApiError(404, "Изображение не найдено.");
  c.header("Content-Type", media.mimeType);
  c.header("Content-Length", String(media.file.size));
  c.header("Content-Disposition", "inline");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, max-age=2592000");
  return c.body(media.file.stream());
});

app.get("/api/messages/direct/:username", async (c) => {
  const user = requireUser(c);
  const thread = await getMessageThread(user.id, c.req.param("username"), optionalPositiveQuery(c, "before"));
  if (!thread) throw new ApiError(404, "Пользователь сайта не найден.");
  return c.json({ ok: true, thread });
});

app.get("/api/messages/direct/:username/updates", async (c) => {
  const user = requireUser(c);
  const after = nonNegativeQuery(c, "after");
  const updates = await getMessageUpdates(user.id, c.req.param("username"), after);
  if (!updates) throw new ApiError(404, "Пользователь сайта не найден.");
  return c.json({ ok: true, ...updates });
});

app.post("/api/messages/direct/:username", async (c) => {
  const user = requireUser(c);
  const input = await messageInput(c);
  let stored = false;
  try {
    const result = await sendPrivateMessage(user.id, c.req.param("username"), input.body, input.images);
    if (!result.ok) serviceError(result);
    stored = true;
    return c.json({ ok: true, message: result.message }, 201);
  } finally {
    if (!stored) cleanupMessageImages(input.images);
  }
});

app.post("/api/messages/groups/join", async (c) => {
  const user = requireUser(c);
  const data = await jsonObject(c, ["token"]);
  const token = text(data.token, "token", 100);
  const result = await joinGroupByInvite(user.id, token);
  if (!result.ok) serviceError(result);
  return c.json({ ok: true, groupId: result.groupId });
});

app.post("/api/messages/groups", async (c) => {
  const user = requireUser(c);
  const data = await jsonObject(c, ["title", "members"]);
  const title = text(data.title, "title", 80);
  let members: string[] = [];
  if (data.members !== undefined) {
    if (!Array.isArray(data.members) || data.members.length > 49 || data.members.some((item) => typeof item !== "string")) {
      throw new ApiError(400, "members: нужен массив не более чем из 49 логинов.");
    }
    members = (data.members as string[]).map((item) => item.trim());
    if (members.some((item) => !/^[A-Za-z0-9_]{3,32}$/.test(item))) {
      throw new ApiError(400, "members: каждый элемент должен быть корректным логином сайта.");
    }
  }
  const result = await createGroupChat(user.id, title, members);
  if (!result.ok) serviceError(result);
  const thread = await getGroupThread(user.id, result.groupId);
  if (!thread) throw new ApiError(404, "Созданная группа не найдена.");
  c.header("Location", `/api/messages/groups/${result.groupId}`);
  return c.json({ ok: true, thread: apiGroupThread(thread) }, 201);
});

app.get("/api/messages/groups/:id", async (c) => {
  const user = requireUser(c);
  const thread = await getGroupThread(user.id, routeId(c), optionalPositiveQuery(c, "before"));
  if (!thread) throw new ApiError(404, "Групповой чат не найден или вы не участник.");
  return c.json({ ok: true, thread: apiGroupThread(thread) });
});

app.get("/api/messages/groups/:id/updates", async (c) => {
  const user = requireUser(c);
  const updates = await getGroupUpdates(user.id, routeId(c), nonNegativeQuery(c, "after"));
  if (!updates) throw new ApiError(404, "Групповой чат не найден или вы не участник.");
  return c.json({ ok: true, messages: updates });
});

app.post("/api/messages/groups/:id/messages", async (c) => {
  const user = requireUser(c);
  const input = await messageInput(c);
  let stored = false;
  try {
    const result = await sendGroupMessage(user.id, routeId(c), input.body, input.images);
    if (!result.ok) serviceError(result);
    stored = true;
    return c.json({ ok: true, message: result.message }, 201);
  } finally {
    if (!stored) cleanupMessageImages(input.images);
  }
});

app.post("/api/messages/groups/:id/members", async (c) => {
  const user = requireUser(c);
  const data = await jsonObject(c, ["username"]);
  const username = text(data.username, "username", 32);
  const groupId = routeId(c);
  const result = await addGroupMember(user.id, groupId, username);
  if (!result.ok) serviceError(result);
  return c.json({ ok: true }, 201);
});

app.delete("/api/messages/groups/:id/members/:userId", async (c) => {
  const user = requireUser(c);
  const rawUserId = c.req.param("userId");
  if (!/^[1-9]\d*$/.test(rawUserId)) throw new ApiError(400, "Некорректный userId.");
  const result = await removeGroupMember(user.id, routeId(c), positiveId(Number(rawUserId), "userId"));
  if (!result.ok) serviceError(result);
  return c.json({ ok: true });
});

app.post("/api/messages/groups/:id/invite/reset", async (c) => {
  const user = requireUser(c);
  const groupId = routeId(c);
  const result = await resetGroupInvite(user.id, groupId);
  if (!result.ok) serviceError(result);
  const thread = await getGroupThread(user.id, groupId);
  if (!thread) throw new ApiError(404, "Групповой чат не найден.");
  return c.json({ ok: true, inviteUrl: inviteUrl(thread.group.inviteToken) });
});

app.post("/api/messages/groups/:id/leave", async (c) => {
  const user = requireUser(c);
  const result = await leaveGroup(user.id, routeId(c));
  if (!result.ok) serviceError(result);
  return c.json({ ok: true });
});

app.delete("/api/messages/groups/:id", async (c) => {
  const user = requireUser(c);
  const result = await deleteGroup(user.id, routeId(c));
  if (!result.ok) serviceError(result);
  return c.json({ ok: true });
});

app.get("/api/categories", async (c) => {
  const items = await getDrizzle().select({
    id: categories.id, parentId: categories.parentId, name: categories.name,
    slug: categories.slug, type: categories.type, sortOrder: categories.sortOrder,
  }).from(categories).orderBy(categories.sortOrder, categories.id);
  return c.json({ ok: true, items });
});

app.get("/api/tags", async (c) => {
  const items = await getDrizzle().select({
    id: tags.id, name: tags.name, slug: tags.slug, group: tags.group, weight: tags.weight,
  }).from(tags).orderBy(tags.name, tags.id);
  return c.json({ ok: true, items });
});

app.get("/api/topics", async (c) => {
  const pageValue = c.req.query("page") ?? "1";
  const limitValue = c.req.query("limit") ?? "20";
  if (!/^[1-9]\d*$/.test(pageValue) || !/^[1-9]\d*$/.test(limitValue)) {
    throw new ApiError(400, "page и limit должны быть положительными целыми числами.");
  }
  const page = positiveId(Number(pageValue), "page");
  const limit = positiveId(Number(limitValue), "limit");
  if (page > 1_000_000 || limit > 100) throw new ApiError(400, "page не больше 1000000, limit не больше 100.");
  const q = c.req.query("q");
  const category = c.req.query("category");
  if (q !== undefined) {
    const query = text(q, "q", 200);
    if (category !== undefined) throw new ApiError(400, "Нельзя сочетать q и category.");
    const result = await searchTopics(query, page, limit);
    return c.json({ ok: true, ...result, limit });
  }
  if (category !== undefined) text(category, "category", 200);
  const result = await getTopicsByCategory(category, page, limit);
  return c.json({ ok: true, ...result, page, limit });
});

app.get("/api/topics/:id", async (c) => {
  const topic = await visibleTopic(routeId(c));
  return c.json({ ok: true, topic });
});

app.post("/api/topics", async (c) => {
  const user = requireUser(c);
  const data = await jsonObject(c, ["title", "body", "categoryId", "tagIds"]);
  const input = await topicInput(data);
  const slug = await uniqueSlug(slugify(input.title));
  const id = await createTopic({ ...input, slug, authorId: user.id });
  const topic = await visibleTopic(id);
  c.header("Location", `/api/topics/${id}`);
  return c.json({ ok: true, topic }, 201);
});

app.patch("/api/topics/:id", async (c) => {
  const user = requireUser(c);
  const topic = await visibleTopic(routeId(c));
  editableTopic(topic, user);
  const data = await jsonObject(c, ["title", "body", "categoryId", "tagIds"]);
  await updateTopic(topic.id, await topicInput(data, topic));
  return c.json({ ok: true, topic: await visibleTopic(topic.id) });
});

app.delete("/api/topics/:id", async (c) => {
  const user = requireUser(c);
  const topic = await visibleTopic(routeId(c));
  editableTopic(topic, user);
  await deleteTopic(topic.id);
  return c.json({ ok: true });
});

app.get("/api/topics/:id/comments", async (c) => {
  const topic = await visibleTopic(routeId(c));
  const items = await getComments(topic.id);
  // Не выдаём потомков скрытого комментария как самостоятельные корни.
  const byId = new Map(items.map((comment) => [comment.id, comment]));
  const visibility = new Map<number, boolean>();
  const visible = (comment: TopicComment): boolean => {
    const path: number[] = [];
    const seen = new Set<number>();
    let current: TopicComment | undefined = comment;
    let allowed = false;
    while (current) {
      const cached = visibility.get(current.id);
      if (cached !== undefined) { allowed = cached; break; }
      if (seen.has(current.id)) break;
      seen.add(current.id);
      path.push(current.id);
      if (current.parentId === null) { allowed = true; break; }
      current = byId.get(current.parentId);
    }
    for (const id of path) visibility.set(id, allowed);
    return allowed;
  };
  return c.json({ ok: true, items: items.filter(visible) });
});

app.post("/api/topics/:id/comments", async (c) => {
  const user = requireUser(c);
  const topic = await visibleTopic(routeId(c));
  const data = await jsonObject(c, ["body", "parentId"]);
  const body = commentBody(data.body);
  const parentId = data.parentId === undefined || data.parentId === null
    ? null : positiveId(data.parentId, "parentId");
  if (parentId !== null) {
    const parent = await visibleComment(parentId);
    if (parent.topicId !== topic.id) throw new ApiError(400, "Родительский комментарий принадлежит другому топику.");
  }
  const id = await addComment({ topicId: topic.id, parentId, body, authorId: user.id });
  const comment = await getCommentById(id);
  return c.json({ ok: true, comment }, 201);
});

app.patch("/api/comments/:id", async (c) => {
  const user = requireUser(c);
  const comment = await visibleComment(routeId(c));
  if (comment.authorId !== user.id || comment.isRemoteAuthor) {
    throw new ApiError(403, "Редактировать комментарий может только его местный автор.");
  }
  const data = await jsonObject(c, ["body"]);
  if (!await updateComment(comment.id, commentBody(data.body))) {
    throw new ApiError(403, "Комментарий недоступен для редактирования.");
  }
  return c.json({ ok: true, comment: await getCommentById(comment.id) });
});

app.delete("/api/comments/:id", async (c) => {
  const user = requireUser(c);
  const comment = await visibleComment(routeId(c));
  if (comment.authorId !== user.id && !isStaff(user)) {
    throw new ApiError(403, "Удалить комментарий может только автор или редактор.");
  }
  if (await getCommentChildrenCount(comment.id) > 0) {
    throw new ApiError(409, "Нельзя удалить комментарий, на который уже ответили.");
  }
  await deleteComment(comment.id, comment.topicId);
  return c.json({ ok: true });
});

for (const entityType of ["topic", "comment"] as const) {
  const path = entityType === "topic" ? "/api/topics/:id/vote" : "/api/comments/:id/vote";
  app.post(path, async (c) => {
    const user = requireUser(c);
    const id = routeId(c);
    if (entityType === "topic") await visibleTopic(id);
    else await visibleComment(id);
    const data = await jsonObject(c, ["value"]);
    if (data.value !== 1 && data.value !== -1) throw new ApiError(400, "value должен быть 1 или -1.");
    const result = await castVote(user, entityType, id, data.value);
    if (!result.ok) {
      const status = result.error === "Аккаунт заблокирован" ? 403
        : result.error === "Вы уже проголосовали за этот топик." ? 409 : 404;
      return c.json(result, status);
    }
    return c.json(result);
  });
}

app.all("/api", (c) => c.json({ ok: false, error: "Метод API не найден." }, 404));
app.all("/api/*", (c) => c.json({ ok: false, error: "Метод API не найден." }, 404));

export default app;
