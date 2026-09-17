import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import { HotTopics, RecentDiscussions, NewOnSite, SidebarAd } from "../sidebar/components";
import { createTopic, getEditableCategories, getHotTopics, getRecentDiscussions, getRecentTopics, uniqueSlug } from "../topics/service";
import { getForumTags } from "../forum/service";
import { slugify, sanitizeHtml, stripTags, firstImageSrc } from "../core/utils";
import { CONTENT_FIELD, NewTopicForm, editorHead } from "./components";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

const MAX_CONTENT_LENGTH = 200_000;
const MAX_FILES = 8;
const MAX_FILE_SIZE = 8 * 1024 * 1024;

const uploadExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

async function renderSidebar() {
  const [hot, discussions, recent] = await Promise.all([
    getHotTopics(8),
    getRecentDiscussions(8),
    getRecentTopics(8),
  ]);
  return (
    <div>
      <SidebarAd />
      <HotTopics items={hot} />
      <RecentDiscussions items={discussions} />
      <NewOnSite items={recent} />
    </div>
  );
}

function uploadScript(editorId: string, payload: { html?: string } | { error?: string }): string {
  const json = JSON.stringify(payload).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `<script>top.e_['${editorId}'].insertimage_mod('${json}');</script>`;
}

function imageHtml(file: string, align: string): string {
  if (align === "center") {
    return `<div align="center"><img src="/uploads/${file}" hspace="5" vspace="5" width="580" height="400"></div>`;
  }
  if (align === "left") {
    return `<img src="/uploads/${file}" align="left" hspace="5" vspace="5" width="208" height="208">`;
  }
  if (align === "right") {
    return `<img src="/uploads/${file}" align="right" hspace="5" vspace="5" width="208" height="208">`;
  }
  return `<img src="/uploads/${file}" hspace="5" vspace="5" width="580" height="400">`;
}

app.get("/new_topic", async (c) => {
  if (!c.get("user")) return c.redirect("/login");
  const [categories, { os, quest }, sidebar] = await Promise.all([getEditableCategories(), getForumTags(), renderSidebar()]);
  return c.html(
    await layoutWithSidebar({
      title: "Новый топик",
      user: c.get("user") ?? null,
      head: editorHead,
      sidebar,
      children: (
        <NewTopicForm
          categories={categories}
          os={os}
          quest={quest}
          categoryId={categories.find((x) => x.slug === "b_questions")?.id ?? categories[0]?.id}
        />
      ),
    })
  );
});

async function renderForm(c: any, values: {
  title: string;
  categoryId: number | undefined;
  tagIds: number[];
  body: string;
  error?: string;
}) {
  const [categories, { os, quest }, sidebar] = await Promise.all([getEditableCategories(), getForumTags(), renderSidebar()]);
  return c.html(
    await layoutWithSidebar({
      title: "Новый топик",
      user: c.get("user") ?? null,
      head: editorHead,
      sidebar,
      children: (
        <NewTopicForm
          categories={categories}
          os={os}
          quest={quest}
          title={values.title}
          categoryId={values.categoryId}
          tagIds={values.tagIds}
          body={values.body}
          error={values.error}
        />
      ),
    })
  );
}

async function handleSubmit(c: any) {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (user.banned) return c.redirect("/login");
  const form = await c.req.parseBody();
  const title = String(form["title"] ?? "").trim();
  const categoryId = Number(form["category_id"] ?? 0);
  const content = String(form[CONTENT_FIELD] ?? "").trim();
  const rawTags = form["tag_ids"];
  const tagIds = (Array.isArray(rawTags) ? rawTags : rawTags !== undefined ? [rawTags] : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);

  if (!title) {
    return renderForm(c, { title, categoryId, tagIds, body: content, error: "Укажите заголовок топика." });
  }
  if (title.length > 200) {
    return renderForm(c, { title, categoryId, tagIds, body: content, error: "Слишком длинный заголовок (не больше 200 символов)." });
  }
  const body = sanitizeHtml(content);
  if (stripTags(body).length === 0 && !firstImageSrc(body)) {
    return renderForm(c, { title, categoryId, tagIds, body: content, error: "Текст топика не может быть пустым." });
  }
  if (body.length > MAX_CONTENT_LENGTH) {
    return renderForm(c, { title, categoryId, tagIds, body: content, error: "Текст топика слишком большой." });
  }

  const categories = await getEditableCategories();
  const category = categories.find((x) => x.id === categoryId);
  if (!category) {
    return renderForm(c, { title, categoryId, tagIds, body: content, error: "Выберите раздел." });
  }

  const { os, quest } = await getForumTags();
  const validTagIds = new Set([...os, ...quest].map((t) => t.id));
  const allowedTags = [...new Set(tagIds)].filter((id) => validTagIds.has(id)).slice(0, 10);

  const slug = await uniqueSlug(slugify(title));
  const id = await createTopic({
    title,
    slug,
    body,
    categoryId: category.id,
    authorId: user.id,
    leadImage: firstImageSrc(body),
    tagIds: allowedTags,
  });
  return c.redirect(`/topics/${id}/${slug}`);
}

app.post("/new_topic", handleSubmit);

app.post("/upload_image_Bredacture.php", async (c) => {
  if (c.req.query("type") !== "image") return c.text("Not found", 404);
  const body = await c.req.parseBody();
  const editorId = String(body["editor_id"] ?? "").replace(/[^a-zA-Z0-9_]/g, "");
  const user = c.get("user");
  if (!user) return c.html(uploadScript(editorId, { error: "Вы не авторизованы." }));

  const align = String(body["input_align"] ?? "").trim();
  const files = body["NewFile"];
  const list = (Array.isArray(files) ? files : files !== undefined ? [files] : []).filter(
    (f): f is File => f instanceof File
  );
  if (!list.length) return c.html(uploadScript(editorId, { error: "Файл не выбран." }));

  const till = list.slice(0, MAX_FILES);
  const htmls: string[] = [];
  for (const file of till) {
    const ext = uploadExtensions[file.type];
    if (!ext || file.size > MAX_FILE_SIZE) {
      return c.html(uploadScript(editorId, { error: "Недопустимый формат файла (jpg/png/gif/webp, до 8 МБ)." }));
    }
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    mkdirSync("public/uploads", { recursive: true });
    await Bun.write(`public/uploads/${name}`, file);
    htmls.push(imageHtml(name, align));
  }
  return c.html(uploadScript(editorId, { html: htmls.join("\n") }));
});

export default app;