import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  getTopicsByCategory,
  getTopicBySlug,
  getFeaturedTopics,
  getRecentTopics,
  getRecentDiscussions,
  getLeaderboard,
  getHotTopics,
} from "./service";
import {
  TopicCard,
  TopicDetailView,
  FeaturedCarousel,
  Leaderboard,
  Pagination,
} from "./components";
import {
  RecentDiscussions,
  NewOnSite,
  HotTopics,
  SidebarAd,
} from "../sidebar/components";
import { CommentList, CommentForm } from "../comments/components";
import { getComments, addComment } from "../comments/service";

const app = new Hono<{ Variables: UserContext }>();

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
  const [featured, leaderboard, sidebar] = await Promise.all([
    getFeaturedTopics(5),
    getLeaderboard(),
    renderSidebar(),
  ]);

  const html = layoutWithSidebar({
    title: `Главная — ${config.siteName}`,
    description: `${config.siteName} — лучший мобильный портал. Новости, программы, обзоры.`,
    user: c.get("user") ?? null,
    currentSection: "news",
    sidebar,
    children: (
      <div>
        <FeaturedCarousel items={featured} />
        <Leaderboard authors={leaderboard.authors} commenters={leaderboard.commenters} />
        {items.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
        <Pagination
          page={page}
          total={total}
          perPage={config.mainPageSize}
          basePath="/page_topics"
        />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.get("/page_topics/:page/", async (c) => {
  const page = Number(c.req.param("page")) || 1;
  const { items, total } = await getTopicsByCategory(undefined, page, config.mainPageSize);
  const [featured, sidebar] = await Promise.all([getFeaturedTopics(5), renderSidebar()]);

  const html = layoutWithSidebar({
    title: `${page} страница — ${config.siteName}`,
    user: c.get("user") ?? null,
    currentSection: "news",
    sidebar,
    children: (
      <div>
        <FeaturedCarousel items={featured} />
        {items.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
        <Pagination
          page={page}
          total={total}
          perPage={config.mainPageSize}
          basePath="/page_topics"
        />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

for (const slug of Object.keys(categorySections)) {
  app.get(`/public/${slug}/`, async (c) => {
    const { items, total } = await getTopicsByCategory(slug, 1, config.pageSize);
    const sidebar = await renderSidebar();
    const title = titleBySlug[slug] ?? slug;
    const html = layoutWithSidebar({
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

  app.get(`/public/${slug}/page_topics/:page/`, async (c) => {
    const page = Number(c.req.param("page")) || 1;
    const { items, total } = await getTopicsByCategory(slug, page, config.pageSize);
    const sidebar = await renderSidebar();
    const title = titleBySlug[slug] ?? slug;
    const html = layoutWithSidebar({
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

  const [sidebar, comments] = await Promise.all([renderSidebar(), getComments(id)]);
  const html = layoutWithSidebar({
    title: `${topic.title} — ${config.siteName}`,
    description: topic.body.replace(/<[^>]*>/g, "").slice(0, 160),
    user: c.get("user") ?? null,
    currentSection: topic.categorySlug,
    sidebar,
    children: (
      <div>
        <TopicDetailView topic={topic} />
        <a name="comments" />
        <div id="div_comments_0">
          <CommentList comments={comments} />
          <CommentForm topicId={topic.id} loggedIn={Boolean(c.get("user"))} />
        </div>
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
});

app.post("/topics/:id/add_comment/", (c) => {
  const user = c.get("user");
  return postComment(c, user, null);
});

app.post("/topics/:id/add_comment/:parentId/", (c) => {
  const user = c.get("user");
  return postComment(c, user, Number(c.req.param("parentId")) || null);
});

async function postComment(c: any, user: any, parentId: number | null) {
  if (!user) return c.redirect("/login");
  const id = Number(c.req.param("id")) || 0;
  const topic = await getTopicBySlug(id);
  if (!topic) return c.notFound();
  const body = await c.req.parseBody();
  const text = String(body.body ?? "").trim().slice(0, 4000);
  if (!text) return c.redirect(`/topics/${id}/${topic.slug}`);
  await addComment({ topicId: id, parentId, authorId: user.id, body: text });
  return c.redirect(`/topics/${id}/${topic.slug}#div_comments_0`);
}

app.get("/public/all_topics/", async (c) => {
  const page = Number(c.req.query("page")) || 1;
  const { items, total } = await getTopicsByCategory(undefined, page, config.pageSize);
  const sidebar = await renderSidebar();
  const html = layoutWithSidebar({
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
});

void titleBySlug;

export default app;