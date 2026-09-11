import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  getTopicsByCategory,
  getTopicBySlug,
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
import { getComments, addComment, getCommentById, getCommentChildrenCount, deleteComment } from "../comments/service";
import { deleteTopic } from "./service";

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
    description: `${config.siteName} — лучший мобильный портал. Новости, программы, обзоры.`,
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
  const canDeleteTopic = Boolean(me && (topic.authorId === me.id || me.role !== "user"));
  const canDeleteComments = Boolean(me && me.role !== "user");
  const currentUserId = me?.id ?? null;

  const [sidebar, comments] = await Promise.all([renderSidebar(), getComments(id)]);
  const html = await layoutWithSidebar({
    title: `${topic.title} — ${config.siteName}`,
    description: topic.body.replace(/<[^>]*>/g, "").slice(0, 160),
    user: c.get("user") ?? null,
    currentSection: topic.categorySlug,
    sidebar,
    children: (
      <div>
        <TopicDetailView topic={topic} canDelete={canDeleteTopic} />
        <a name="comments" />
        <div id="div_comments_0">
          <CommentList
            comments={comments}
            canDelete={canDeleteComments}
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
    const canDel = user.role !== "user";
    if (fresh) html = String(<CommentFragment comment={fresh} canDelete={canDel} currentUserId={user.id} />);
    return c.json({ ok: true, html, parentId });
  }
  return c.redirect(`/topics/${id}/${topic.slug}#div_comments_0`);
}

app.post("/topics/:id/delete_comment/:commentId", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const commentId = Number(c.req.param("commentId")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  const comment = await getCommentById(commentId);
  if (!comment || comment.topicId !== id) return c.notFound();
  const canModerate = comment.authorId === user.id || user.role !== "user";
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
  const canModerate = topic.authorId === user.id || user.role !== "user";
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

void titleBySlug;

export default app;