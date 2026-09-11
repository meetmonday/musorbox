import type { FC } from "hono/jsx";
import { Header, LogoMenu, type LayoutUser } from "./header";
import { Footer } from "./footer";
import { config } from "../core/config";
import { FeaturedCarousel } from "../topics/components";
import { getFeaturedTopics } from "../topics/service";

export type LayoutProps = {
  title: string;
  description?: string;
  user: LayoutUser;
  children: unknown;
  sidebar?: unknown;
  currentSection?: string;
  featured?: unknown;
  head?: unknown;
};

const sectionLinks: Record<string, string> = {
  news: "/public/b_news/",
  text: "/public/b_text/",
  reviews: "/public/reviews/",
  progs: "/public/progs/",
  games: "/public/games/",
  themes: "/public/themes/",
  forum: "/public/b_questions/",
  circles: "/public/circles/",
  podcasts: "/public/podcasts/",
  contests: "/public/users/",
  help: "/public/help/",
  offtop: "/public/offtop/",
};

export const Layout: FC<LayoutProps> = ({
  title,
  description,
  user,
  children,
  sidebar,
  currentSection,
  featured,
  head,
}) => {
  const curSection = currentSection ? sectionLinks[currentSection] : undefined;
  return (
    <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta http-equiv="Content-Language" content="ru" />
        <title>{title}</title>
        {description ? <meta name="description" content={description} /> : null}
        <link rel="alternate" type="application/rss+xml" title={`${config.siteName} RSS`} href="/feed_topics/1/" />
        <link rel="stylesheet" href="/css/main.css?20130805" />
        <link rel="stylesheet" href="/css/ads.css?20130805" />
        <script src="/js/app.js" defer />
        {head}
      </head>
      <body>
        <Header user={user} />
        <div class="div_layout">
          <LogoMenu />
          {featured}
          {children}
          <div class="div_bottom_spacer" style="height:30px"> </div>
        </div>
        <Footer />
      </body>
    </html>
  );
};

async function withFeatured(props: LayoutProps) {
  const featured = await getFeaturedTopics(5);
  return (
    <Layout {...props} featured={<FeaturedCarousel items={featured} />}>
      {props.children}
    </Layout>
  );
}

export async function renderPage(props: LayoutProps) {
  return withFeatured(props);
}

export async function layoutWithSidebar(props: LayoutProps) {
  const { sidebar, children, ...rest } = props;
  const featured = await getFeaturedTopics(5);
  return (
    <Layout {...rest} featured={<FeaturedCarousel items={featured} />}>
      <div class="div_table ad2">
        <div class="div_row ad2">
          <div class="div_cell div_page_left ad2">{children}</div>
          <div class="div_cell div_page_right ad2" id="div_page_right">
            {sidebar}
          </div>
        </div>
      </div>
    </Layout>
  );
}