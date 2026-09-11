import { Hono } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar, renderPage } from "../layout/layout";
import { getTopicsByCategory, getHotTopics, getRecentDiscussions, getRecentTopics } from "../topics/service";
import type { TopicListItem } from "../topics/service";
import { getForumThreads } from "../forum/service";
import { HotTopics, RecentDiscussions, NewOnSite, SidebarAd } from "../sidebar/components";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

const rssTitles: Record<string, string> = {
  "1": "Все топики",
  b_news: "Новости",
  b_text: "Статьи",
  reviews: "Обзоры",
  progs: "Программы",
  games: "Игры",
  themes: "Темы",
  b_questions: "Форум",
};

const baseUrl = `http://localhost:${config.port}`;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function rssChannel(title: string, items: TopicListItem[]): string {
  const toc = (d: Date) => d.toUTCString();
  const itemXml = items.map((t) => {
    const link = `${baseUrl}/topics/${t.id}/${t.slug}`;
    return [
      `<item>`,
      `  <title>${escapeXml(t.title)}</title>`,
      `  <link>${escapeXml(link)}</link>`,
      `  <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `  <pubDate>${toc(t.createdAt)}</pubDate>`,
      `  <category>${escapeXml(t.categoryName)}</category>`,
      `  <description>${escapeXml(stripHtml(t.body).slice(0, 300))}</description>`,
      `</item>`,
    ].join("\n");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>${baseUrl}/</link>\n    <description>${escapeXml(title)} — ${config.siteTagline}</description>\n    <language>ru</language>\n    <lastBuildDate>${toc(new Date())}</lastBuildDate>\n${itemXml.join("\n")}\n  </channel>\n</rss>`;
}

app.get("/feed_topics/:channel", async (c) => {
  const channel = c.req.param("channel") as string;
  let items: TopicListItem[] = [];
  if (channel === "1") {
    ({ items } = await getTopicsByCategory(undefined, 1, 30));
  } else if (channel === "b_questions") {
    const r = await getForumThreads(undefined, 1, 30);
    items = r.items;
  } else {
    ({ items } = await getTopicsByCategory(channel, 1, 30));
  }
  const title = `${config.siteName} — ${rssTitles[channel] ?? channel}`;
  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  return c.body(rssChannel(title, items));
});

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

async function renderSectionPage(
  c: any,
  opts: { title: string; section: string; children: unknown },
) {
  const sidebar = await renderSidebar();
  const html = await layoutWithSidebar({
    title: `${opts.title} — ${config.siteName}`,
    user: c.get("user") ?? null,
    currentSection: opts.section,
    sidebar,
    children: opts.children,
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

function sectionBody(title: string, paragraphs: string[]): unknown {
  return (
    <div>
      <h1 class="h_page_header">{title}</h1>
      {paragraphs.map((p) => (
        <div style="margin:12px 0;font-size:1.3em;line-height:1.6">{p}</div>
      ))}
    </div>
  );
}

app.get("/public/circles", (c) =>
  renderSectionPage(c, {
    title: "Колонки",
    section: "circles",
    children: sectionBody(
      "Колонки",
      [
        "Авторские колонки постоянных авторов сайта.",
        "Каждый автор ведёт собственную колонку и делится личным мнением о мобильных технологиях.",
        "Раздел находится в разработке. Следите за обновлениями!",
      ],
    ),
  }),
);

app.get("/public/podcasts", (c) =>
  renderSectionPage(c, {
    title: "Подкасты",
    section: "podcasts",
    children: sectionBody(
      "Подкасты",
      [
        `Аудио- и видеоподкасты редакции ${config.siteName} о новостях мобильного мира.`,
        "Обсуждаем свежие анонсы, железо и софт, отвечаем на вопросы читателей.",
        "Раздел находится в разработке. Следите за обновлениями!",
      ],
    ),
  }),
);

app.get("/public/users", (c) =>
  renderSectionPage(c, {
    title: "Конкурсы",
    section: "contests",
    children: sectionBody(
      "Конкурсы",
      [
        `Конкурсы для читателей ${config.siteName}: призы, активности и рейтинги пользователей.`,
        "Скоро здесь появятся новые конкурсы. Следите за новостями!",
      ],
    ),
  }),
);

app.get("/public/help", (c) =>
  renderSectionPage(c, {
    title: "Помощь",
    section: "help",
    children: sectionBody(
      "Помощь по сайту",
      [
        "Как добавить топик: нажмите «Добавить топик» в меню сайта, заполните форму и отправьте — после модерации он появится на сайте.",
        "Как задать вопрос на форуме: перейдите в раздел «Форум», выберите подходящую тему и создайте новый топик с тегом.",
        "Как изменить профиль: зайдите на свою страницу профиля и нажмите «Редактировать».",
        "По остальным вопросам пишите в комментарии или на почту редакции.",
      ],
    ),
  }),
);

async function renderPlainPage(c: any, opts: { title: string; children: unknown }) {
  const html = await renderPage({
    title: `${opts.title} — ${config.siteName}`,
    user: c.get("user") ?? null,
    children: opts.children,
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

app.get("/rules", (c) =>
  renderPlainPage(c, {
    title: "Правила сайта",
    children: sectionBody(
      "Правила сайта",
      [
        "Уважайте других участников: никаких оскорблений, троллинга и флейма без причины.",
        "Не публикуйте спам, рекламу и ссылки на вредоносные ресурсы.",
        "Обсуждайте темы по существу. Оффтоп в комментариях не приветствуется.",
        "Запрещена публикация материалов, нарушающих законодательство РФ.",
        "Администрация оставляет за собой право удалять топики и комментарии без объяснения причин.",
      ],
    ),
  }),
);

app.get("/thanks", (c) =>
  renderPlainPage(c, {
    title: "Благодарности",
    children: sectionBody(
      "Благодарности",
      [
        `${config.siteName} не состоялся бы без наших читателей, авторов и модераторов.`,
        "Спасибо всем, кто пишет новости, отвечает на вопросы на форуме и помогает делать сайт лучше!",
      ],
    ),
  }),
);

app.get("/copyright", (c) =>
  renderPlainPage(c, {
    title: "Правообладателям",
    children: sectionBody(
      "Правообладателям",
      [
        "Все материалы, размещённые на сайте, принадлежат их авторам.",
        "Если вы обнаружили на сайте материал, нарушающий ваши авторские права, напишите нам — мы оперативно удалим его или заменим ссылкой на первоисточник.",
      ],
    ),
  }),
);

app.get("/advertising", (c) =>
  renderPlainPage(c, {
    title: "Реклама, обзоры и сотрудничество",
    children: sectionBody(
      "Реклама, обзоры и сотрудничество",
      [
        `${config.siteName} предлагает размещение рекламы, подготовку обзоров и другие форматы сотрудничества.`,
        `По вопросам рекламы и сотрудничества обращайтесь по адресу: ${config.contactEmail}`,
      ],
    ),
  }),
);

export default app;