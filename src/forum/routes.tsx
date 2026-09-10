import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import { getForumThreads, getForumTags, getTagBySlugPublic } from "./service";
import { ThreadList, ForumPagination, TagFilter } from "./components";
import { RecentDiscussions, NewOnSite, HotTopics, SidebarAd } from "../sidebar/components";
import { getHotTopics, getRecentDiscussions, getRecentTopics } from "../topics/service";
import { formatDate, pluralize } from "../core/utils";

const app = new Hono<{ Variables: UserContext }>();

const perPage = 20;

function tagTitle(tag: string): string {
  const map: Record<string, string> = {
    os_android: "Android",
    os_Android_3: "Android 3.0",
    os_java: "Java",
    os_symbian9: "Symbian 9.1, 9.2, 9.3",
    os_wm: "Windows Mobile 5, 6, 6.1, 6.5",
    os_wp8: "Windows Phone 8",
    os_ios_phone: "iPhone",
    os_ios_ipad: "iPad",
    os_comp: "Для компьютера",
    os_other: "Другая",
    quest_hardware: "Железо",
    quest_games: "Игры",
    quest_settings: "Настройка",
    quest_talk: "Общение",
    quest_buy: "Покупка",
    quest_programms: "Программы",
    quest_firmware: "Прошивка",
    quest_themes: "Темы",
    quest_trashbox: "Трешбокс",
    quest_convert: "Конвертирование",
  };
  return map[tag] ?? tag;
}

async function renderSidebar() {
  const [hot, discussions, recent] = await Promise.all([
    getHotTopics(6),
    getRecentDiscussions(6),
    getRecentTopics(6),
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

async function renderForumPage(c: any, opts: { tag?: string; page?: number; title: string; headerExtra?: () => unknown }) {
  const page = opts.page ?? 1;
  const [tagsData, threads, sidebar] = await Promise.all([
    getForumTags(),
    getForumThreads(opts.tag, page, perPage),
    renderSidebar(),
  ]);

  const totalPages = Math.max(1, Math.ceil(threads.total / perPage));
  const threadCountText = `${threads.total} ${pluralize(threads.total, "тема", "темы", "тем")}`;

  const html = layoutWithSidebar({
    title: opts.title,
    user: c.get("user") ?? null,
    currentSection: "forum",
    sidebar,
    children: (
      <div>
        <h1 class="h_page_header">Форум</h1>
        <TagFilter os={tagsData.os} quest={tagsData.quest} />

        {opts.tag ? (
          <div style="margin-bottom:15px;font-size:1.4em">
            Тема: <b>{tagTitle(opts.tag)}</b>{" "}
            <a href="/public/b_questions/" class="a_dashed">
              показать все темы
            </a>
          </div>
        ) : null}

        <div class="dark" style="margin-bottom:10px;font-size:1.2em">{threadCountText}</div>

        <ForumPagination
          page={page}
          total={threads.total}
          perPage={perPage}
          basePath={opts.tag ? `/public/b_questions/tags/${opts.tag}` : "/public/b_questions"}
        />
        <ThreadList items={threads.items} />
        <ForumPagination
          page={page}
          total={threads.total}
          perPage={perPage}
          basePath={opts.tag ? `/public/b_questions/tags/${opts.tag}` : "/public/b_questions"}
        />

        <div style="margin-top:20px;font-size:1.2em;color:#999">
          <a href="/feed_topics/b_questions/" class="dark2">RSS форума</a>
        </div>
        {opts.headerExtra ? opts.headerExtra() : null}
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/public/b_questions/", async (c) => {
  return renderForumPage(c, {
    title: `Форум — ${config.siteName}`,
  });
});

app.get("/public/b_questions/page_topics/:page/", async (c) => {
  const page = Number(c.req.param("page")) || 1;
  return renderForumPage(c, {
    page,
    title: `${page} страница форума — ${config.siteName}`,
  });
});

app.get("/public/b_questions/tags/:tag/", async (c) => {
  const tag = c.req.param("tag");
  const tagObj = await getTagBySlugPublic(tag);
  if (!tagObj) return c.notFound();
  return renderForumPage(c, {
    tag,
    title: `${tagTitle(tag)} — Форум — ${config.siteName}`,
  });
});

app.get("/public/b_questions/tags/:tag/page_topics/:page/", async (c) => {
  const tag = c.req.param("tag");
  const page = Number(c.req.param("page")) || 1;
  const tagObj = await getTagBySlugPublic(tag);
  if (!tagObj) return c.notFound();
  return renderForumPage(c, {
    tag,
    page,
    title: `${page} страница — ${tagTitle(tag)} — Форум — ${config.siteName}`,
  });
});

export default app;

void formatDate;