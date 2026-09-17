import type { Context } from "hono";
import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  getTopicsByCategory,
  getTopicBySlug,
  searchTopics,
  getRecentTopics,
  getRecentDiscussions,
  getLeaderboard,
  getHotTopics,
} from "./service";
import {
  TopicCard,
  TopicDetailView,
  Leaderboard,
  Pagination,
} from "./components";
import {
  RecentDiscussions,
  NewOnSite,
  HotTopics,
  SidebarAd,
} from "../sidebar/components";
import { CommentFragment, CommentList, CommentForm } from "../comments/components";
import { getComments, addComment, getCommentById, getCommentChildrenCount, deleteComment, updateComment } from "../comments/service";
import { deleteTopic, updateTopic } from "./service";
import { isStaff } from "../core/middleware";
import { NewTopicForm, editorHead, CONTENT_FIELD } from "../editor/components";
import { getForumTags } from "../forum/service";
import { getEditableCategories } from "./service";
import { slugify, sanitizeHtml, stripTags, firstImageSrc } from "../core/utils";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

const categorySections = {
  b_news: "news",
  b_text: "text",
  reviews: "reviews",
  progs: "progs",
  games: "games",
  themes: "themes",
};

const sectionKey: Record<string, string> = {
  b_news: "news",
  b_text: "text",
  reviews: "reviews",
  progs: "progs",
  games: "games",
  themes: "themes",
};

const titleBySlug: Record<string, string> = {
  b_news: "Новости",
  b_text: "Статьи",
  reviews: "Обзоры",
  progs: "Программы",
  games: "Игры",
  themes: "Темы",
  all_topics: "Все топики",
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

app.get("/", async (c) => {
  const page = 1;
  const { items, total } = await getTopicsByCategory(undefined, page, config.mainPageSize);
  const [leaderboard, sidebar] = await Promise.all([getLeaderboard(), renderSidebar()]);

  const html = await layoutWithSidebar({
    title: `Главная — ${config.siteName}`,
    description: `${config.siteName} — ${config.siteTagline}. Новости, программы, обзоры.`,
    user: c.get("user") ?? null,
    currentSection: "news",
    sidebar,
    children: (
      <div>
        <Leaderboard authors={leaderboard.authors} commenters={leaderboard.commenters} />
        {items.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
        <Pagination
          page={page}
          total={total}
          perPage={config.mainPageSize}
          basePath=""
        />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.get("/page_topics/:page", async (c) => {
  const page = Number(c.req.param("page")) || 1;
  const { items, total } = await getTopicsByCategory(undefined, page, config.mainPageSize);
  const sidebar = await renderSidebar();

  const html = await layoutWithSidebar({
    title: `${page} страница — ${config.siteName}`,
    user: c.get("user") ?? null,
    currentSection: "news",
    sidebar,
    children: (
      <div>
        {items.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
        <Pagination
          page={page}
          total={total}
          perPage={config.mainPageSize}
          basePath=""
        />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

for (const slug of Object.keys(categorySections)) {
  app.get(`/public/${slug}`, async (c) => {
    const { items, total } = await getTopicsByCategory(slug, 1, config.pageSize);
    const sidebar = await renderSidebar();
    const title = titleBySlug[slug] ?? slug;
    const html = await layoutWithSidebar({
      title: `${title} — ${config.siteName}`,
      user: c.get("user") ?? null,
      currentSection: sectionKey[slug],
      sidebar,
      children: (
        <div>
          <h1 class="h_page_header">{title}</h1>
          <div class="div_tags_menu"> </div>
          {items.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
          <Pagination
            page={1}
            total={total}
            perPage={config.pageSize}
            basePath={`/public/${slug}`}
          />
        </div>
      ),
    });
    return c.html(`<!DOCTYPE html>${html}`);
  });

  app.get(`/public/${slug}/page_topics/:page`, async (c) => {
    const page = Number(c.req.param("page")) || 1;
    const { items, total } = await getTopicsByCategory(slug, page, config.pageSize);
    const sidebar = await renderSidebar();
    const title = titleBySlug[slug] ?? slug;
    const html = await layoutWithSidebar({
      title: `${title} — ${config.siteName}`,
      user: c.get("user") ?? null,
      currentSection: sectionKey[slug],
      sidebar,
      children: (
        <div>
          <h1 class="h_page_header">{title}</h1>
          {items.map((t) => (
            <TopicCard key={t.id} topic={t} />
          ))}
          <Pagination
            page={page}
            total={total}
            perPage={config.pageSize}
            basePath={`/public/${slug}`}
          />
        </div>
      ),
    });
    return c.html(`<!DOCTYPE html>${html}`);
  });
}

app.get("/topics/:id/:slug", async (c) => {
  const id = Number(c.req.param("id")) || 0;
  const slug = c.req.param("slug");
  const topic = await getTopicBySlug(id, slug);
  if (!topic) return c.notFound();

  const me = c.get("user");
  const canDeleteTopic = Boolean(me && (topic.authorId === me.id || isStaff(me)));
  const canEditTopic = canDeleteTopic;
  const canModerate = Boolean(me && isStaff(me));
  const canDeleteComments = Boolean(me && isStaff(me));
  const currentUserId = me?.id ?? null;
  if (topic.hidden && !(me && (topic.authorId === me.id || isStaff(me)))) return c.notFound();

  const [sidebar, comments] = await Promise.all([renderSidebar(), getComments(id, Boolean(me && isStaff(me)))]);
  const hiddenVisible = Boolean(me && (topic.authorId === me.id || isStaff(me)));
  const html = await layoutWithSidebar({
    title: `${topic.title} — ${config.siteName}`,
    description: topic.body.replace(/<[^>]*>/g, "").slice(0, 160),
    user: c.get("user") ?? null,
    currentSection: topic.categorySlug,
    sidebar,
    head: (
      <link rel="alternate" type="application/activity+json" href={`/topics/${id}/${slug}`} />
    ),
    children: (
      <div>
        <TopicDetailView topic={topic} canDelete={canDeleteTopic} canEdit={canEditTopic} canModerate={canModerate} hiddenVisible={hiddenVisible} />
        <a name="comments" />
        <div id="div_comments_0">
          <CommentList
            comments={comments}
            canDelete={canDeleteComments}
            canModerate={canModerate}
            currentUserId={currentUserId}
          />
          <CommentForm topicId={topic.id} loggedIn={Boolean(c.get("user"))} />
        </div>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.post("/topics/:id/add_comment", (c) => {
  const user = c.get("user");
  return postComment(c, user, null);
});

app.post("/topics/:id/add_comment/:parentId", (c) => {
  const user = c.get("user");
  return postComment(c, user, Number(c.req.param("parentId")) || null);
});

function isXhr(c: any): boolean {
  return (
    c.req.header("x-requested-with") === "XMLHttpRequest" ||
    (c.req.header("accept") ?? "").includes("application/json")
  );
}

async function postComment(c: any, user: any, parentId: number | null) {
  const xhr = isXhr(c);
  if (!user) {
    if (xhr) return c.json({ ok: false, error: "auth" }, 401);
    return c.redirect("/login");
  }
  if (user.banned) {
    if (xhr) return c.json({ ok: false, error: "banned" }, 403);
    return c.redirect("/login");
  }
  const id = Number(c.req.param("id")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  const body = await c.req.parseBody();
  const text = String(body.body ?? "").trim().slice(0, 4000);
  if (!text) {
    if (xhr) return c.json({ ok: false, error: "empty" });
    return c.redirect(`/topics/${id}/${topic.slug}`);
  }
  const commentId = await addComment({ topicId: id, parentId, authorId: user.id, body: text });
  if (xhr) {
    const fresh = await getCommentById(commentId);
    let html = "";
    const canModerate = isStaff(user);
    if (fresh) html = String(<CommentFragment comment={fresh} canDelete={canModerate} canModerate={canModerate} currentUserId={user.id} />);
    return c.json({ ok: true, html, parentId });
  }
  return c.redirect(`/topics/${id}/${topic.slug}#div_comments_0`);
}

app.get("/topics/:id/:slug/edit", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  if (topic.authorId !== user.id && !isStaff(user)) return c.text("Forbidden", 403);
  const [categories, { os, quest }, sidebar] = await Promise.all([
    getEditableCategories(),
    getForumTags(),
    renderSidebar(),
  ]);
  return c.html(
    await layoutWithSidebar({
      title: `Редактирование топика — ${config.siteName}`,
      user,
      head: editorHead,
      sidebar,
      children: (
        <NewTopicForm
          editing
          action={`/topics/${topic.id}/${topic.slug}/edit/`}
          categories={categories}
          os={os}
          quest={quest}
          title={topic.title}
          categoryId={topic.categoryId}
          tagIds={topic.tags.map((t) => t.id)}
          body={topic.body}
        />
      ),
    }),
  );
});

app.post("/topics/:id/:slug/edit", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (user.banned) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  if (topic.authorId !== user.id && !isStaff(user)) return c.text("Forbidden", 403);

  const form = await c.req.parseBody();
  const title = String(form["title"] ?? "").trim();
  const categoryId = Number(form["category_id"] ?? 0);
  const content = String(form[CONTENT_FIELD] ?? "").trim();
  const rawTags = form["tag_ids"];
  const tagIds = (Array.isArray(rawTags) ? rawTags : rawTags !== undefined ? [rawTags] : [])
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v > 0);

  const renderError = async (error: string) => {
    const [categories, { os, quest }, sidebar] = await Promise.all([
      getEditableCategories(),
      getForumTags(),
      renderSidebar(),
    ]);
    return c.html(
      await layoutWithSidebar({
        title: "Редактирование топика",
        user,
        head: editorHead,
        sidebar,
        children: (
          <NewTopicForm
            editing
            action={`/topics/${topic.id}/${topic.slug}/edit/`}
            categories={categories}
            os={os}
            quest={quest}
            title={title}
            categoryId={categoryId || topic.categoryId}
            tagIds={tagIds}
            body={content}
            error={error}
          />
        ),
      }),
    );
  };

  if (!title) return renderFormError(c, renderError, "Укажите заголовок топика.");
  if (title.length > 200) return renderFormError(c, renderError, "Слишком длинный заголовок (не больше 200 символов).");
  const body = sanitizeHtml(content);
  if (stripTags(body).length === 0 && !firstImageSrc(body)) {
    return renderFormError(c, renderError, "Текст топика не может быть пустым.");
  }
  if (body.length > 200_000) return renderFormError(c, renderError, "Текст топика слишком большой.");

  const categories = await getEditableCategories();
  const category = categories.find((x) => x.id === categoryId);
  if (!category) return renderFormError(c, renderError, "Выберите раздел.");

  const { os, quest } = await getForumTags();
  const validTagIds = new Set([...os, ...quest].map((t) => t.id));
  const allowedTags = [...new Set(tagIds)].filter((id) => validTagIds.has(id)).slice(0, 10);

  await updateTopic(topic.id, {
    title,
    body,
    categoryId: category.id,
    leadImage: firstImageSrc(body),
    tagIds: allowedTags,
  });
  return c.redirect(`/topics/${topic.id}/${topic.slug}`);
});

function renderFormError(c: any, render: (error: string) => Promise<any>, error: string) {
  return render(error);
}

app.post("/topics/:id/edit_comment/:commentId", async (c) => {
  const user = c.get("user");
  const xhr = isXhr(c);
  if (!user) return xhr ? c.json({ ok: false, error: "auth" }, 401) : c.redirect("/login");
  if (user.banned) return xhr ? c.json({ ok: false, error: "banned" }, 403) : c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const commentId = Number(c.req.param("commentId")) || 0;
  const comment = await getCommentById(commentId);
  if (!comment || comment.topicId !== id) return c.notFound();
  if (comment.authorId !== user.id) return c.text("Forbidden", 403);
  const form = await c.req.parseBody();
  const text = String(form.body ?? "").trim().slice(0, 4000);
  if (!text) return c.json({ ok: false, error: "empty" });
  const updated = await updateComment(commentId, sanitizeHtml(text));
  if (!updated) return c.text("Forbidden", 403);
  if (xhr) {
    const fresh = await getCommentById(commentId);
    let html = "";
    const canModerate = isStaff(user);
    if (fresh) html = String(<CommentFragment comment={fresh} canDelete={canModerate} canModerate={canModerate} currentUserId={user.id} />);
    return c.json({ ok: true, html });
  }
  return c.redirect(`/topics/${id}/${comment.topicId}#div_comment_${commentId}`);
});

app.post("/topics/:id/delete_comment/:commentId", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const commentId = Number(c.req.param("commentId")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  const comment = await getCommentById(commentId);
  if (!comment || comment.topicId !== id) return c.notFound();
  const canModerate = comment.authorId === user.id || isStaff(user);
  if (!canModerate) return c.text("Forbidden", 403);
  const replies = await getCommentChildrenCount(commentId);
  if (replies > 0) return c.redirect(`/topics/${id}/${topic.slug}#div_comments_0`);
  await deleteComment(commentId, id);
  return c.redirect(`/topics/${id}/${topic.slug}#div_comments_0`);
});

app.post("/topics/:id/delete", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  const canModerate = topic.authorId === user.id || isStaff(user);
  if (!canModerate) return c.text("Forbidden", 403);
  await deleteTopic(id);
  return c.redirect(`/public/${topic.categorySlug}/`);
});

async function renderAllTopics(c: any, page: number) {
  const { items, total } = await getTopicsByCategory(undefined, page, config.pageSize);
  const sidebar = await renderSidebar();
  const html = await layoutWithSidebar({
    title: `Все топики — ${config.siteName}`,
    user: c.get("user") ?? null,
    currentSection: "news",
    sidebar,
    children: (
      <div>
        <h1 class="h_page_header">Все топики</h1>
        {items.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
        <Pagination page={page} total={total} perPage={config.pageSize} basePath="/public/all_topics" />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/public/all_topics", (c) => renderAllTopics(c, Number(c.req.query("page")) || 1));
app.get("/public/all_topics/page_topics/:page", (c) =>
  renderAllTopics(c, Number(c.req.param("page")) || 1),
);

async function renderSearch(c: Context<{ Variables: UserContext }>, page: number) {
  const query = (c.req.query("string") ?? "").trim();
  const result = await searchTopics(query, page, config.pageSize);
  const sidebar = await renderSidebar();
  const html = await layoutWithSidebar({
    title: `Поиск по сайту — ${config.siteName}`,
    user: c.get("user") ?? null,
    sidebar,
    children: (
      <div>
        <h1 class="h_page_header">Поиск по сайту</h1>
        <div class="div_block">
          <form method="get" action="/public/search/">
            <label for="input_search_page" class="dark">Поиск по заголовкам и текстам топиков:</label>
            <br />
            <input id="input_search_page" type="text" name="string" value={query} class="input_auth" />
            {" "}
            <input type="submit" value="Найти" />
          </form>
          <p class="dark">
            {!query ? "Введите слово или фразу для поиска." : result.total === 0
              ? "Ничего не найдено. Попробуйте другое слово или фразу."
              : `Найдено топиков: ${result.total}`}
          </p>
        </div>
        {result.items.map((topic) => <TopicCard key={topic.id} topic={topic} />)}
        <Pagination page={result.page} total={result.total} perPage={config.pageSize}
          basePath="/public/search" query={{ string: query }} />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/public/search", (c) => renderSearch(c, Number(c.req.query("page")) || 1));
app.get("/public/search/page_topics/:page", (c) => renderSearch(c, Number(c.req.param("page")) || 1));

void titleBySlug;

export default app;