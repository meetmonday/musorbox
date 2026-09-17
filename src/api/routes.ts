import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
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
import { authenticateApiToken } from "./tokens";

type ApiContext = Context<{ Variables: UserContext }>;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 415;

class ApiError extends Error {
  constructor(public readonly status: ErrorStatus, message: string) {
    super(message);
  }
}

const app = new Hono<{ Variables: UserContext }>({ strict: false });

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
  if (c.req.method !== "GET" && c.req.method !== "HEAD") requireUser(c);
  await next();
});

function requireUser(c: ApiContext): SessionUser {
  const user = c.get("user");
  if (!user) throw new ApiError(401, "Для этого действия нужен API-токен.");
  return user;
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

app.get("/api/me", (c) => {
  const user = requireUser(c);
  return c.json({ ok: true, user: {
    id: user.id, username: user.username, role: user.role, avatarUrl: user.avatarUrl,
    banned: user.banned, unreadCount: user.unreadCount,
  } });
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
