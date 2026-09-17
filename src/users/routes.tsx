import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { changePassword } from "../auth/service";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  getUserByUsername,
  getUserByUsernameWithHandle,
  getRatingFor,
  getTopicsByAuthor,
  updateUserProfile,
} from "./service";
import type { ProfileInput, UserProfile } from "./service";
import { ProfilePage, SettingsPage } from "./components";
import { ThreadList } from "../forum/components";
import { Pagination } from "../topics/components";
import { RecentDiscussions, NewOnSite, HotTopics, SidebarAd } from "../sidebar/components";
import { getHotTopics, getRecentDiscussions, getRecentTopics } from "../topics/service";
import { listFollowingForUi } from "../activitypub/service";
import { pluralize } from "../core/utils";

const app = new Hono<{ Variables: UserContext }>({ strict: false });

const perPage = 20;

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

type AppContext = Context<{ Variables: UserContext }>;

async function handleProfile(c: AppContext) {
  const username = c.req.param("username") as string;
  const profile = await getUserByUsernameWithHandle(username);
  if (!profile) return c.notFound();

  const current = c.get("user") ?? null;
  const isOwner = current?.id === profile.id;
  const [rating, sidebar, following] = await Promise.all([
    getRatingFor(profile.id, profile.ratingOptout),
    renderSidebar(),
    isOwner ? listFollowingForUi(profile.id) : Promise.resolve([]),
  ]);

  const html = await layoutWithSidebar({
    title: `Профиль — ${config.siteName}`,
    user: current,
    sidebar,
    head: (
      <link rel="alternate" type="application/activity+json" href={`/users/${username}`} />
    ),
    children: (
      <ProfilePage
        profile={profile}
        rating={rating}
        isOwner={isOwner}
        following={following}
      />
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

async function renderSettings(c: AppContext, profile: UserProfile, opts: { values?: ProfileInput; error?: string; saved?: boolean } = {}) {
  const html = await layoutWithSidebar({
    title: `Настройки профиля — ${config.siteName}`,
    user: c.get("user") ?? null,
    sidebar: await renderSidebar(),
    children: <SettingsPage profile={profile} {...opts} />,
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

async function handleSettings(c: AppContext) {
  const current = c.get("user");
  if (!current) return c.redirect("/login");
  const username = c.req.param("username") as string;
  const profile = await getUserByUsername(username);
  if (!profile) return c.notFound();
  if (current.id !== profile.id) return c.text("Настройки доступны только владельцу профиля.", 403);
  if (c.req.method === "GET") return renderSettings(c, profile, { saved: c.req.query("saved") === "1" });

  const body = await c.req.parseBody();
  const str = (name: string) => typeof body[name] === "string" ? body[name] as string : "";
  if (str("action") === "password") {
    if (str("new_password") !== str("repeat_password")) {
      return renderSettings(c, profile, { error: "Новый пароль и его повтор не совпадают." });
    }
    const result = await changePassword(current.id, str("current_password"), str("new_password"));
    if (!result.ok) return renderSettings(c, profile, { error: result.error });
    deleteCookie(c, "session_token", { path: "/" });
    return c.redirect("/login?password_changed=1");
  }
  if (str("action") !== "profile") return renderSettings(c, profile, { error: "Неизвестное действие." });
  const values: ProfileInput = {
    fullName: str("full_name"),
    country: str("country"),
    city: str("city"),
    vkUrl: str("vk"),
    twitterUrl: str("twitter"),
    skype: str("skype"),
    devices: str("devices"),
    avatarUrl: str("avatar_url"),
    ratingOptout: str("rating_optout") === "1",
  };
  const result = await updateUserProfile(username, values);
  if (!result.ok) return renderSettings(c, profile, { values, error: result.error });
  return c.redirect(`/users/${username}/settings?saved=1`);
}

app.get("/users/:username", handleProfile);
app.get("/users/:username/settings", handleSettings);
app.post("/users/:username/settings", handleSettings);
app.get("/user_topics/:username", getTopicsPage);
app.get("/user_topics/:username/page_topics/:page", getTopicsPage);

async function getTopicsPage(c: AppContext) {
  const username = c.req.param("username") as string;
  const page = Number(c.req.query("page") ?? c.req.param("page")) || 1;
  const profile = await getUserByUsernameWithHandle(username);
  if (!profile) return c.notFound();

  const [data, sidebar] = await Promise.all([
    getTopicsByAuthor(username, page, perPage),
    renderSidebar(),
  ]);
  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const totalText = `${data.total} ${pluralize(data.total, "топик", "топика", "топиков")}`;
  const displayName = profile.username;

  const html = await layoutWithSidebar({
    title: `Все топики ${displayName} — ${config.siteName}`,
    user: c.get("user") ?? null,
    sidebar,
    children: (
      <div>
        <h1 class="h_page_header">Все топики: {displayName}</h1>
        <div class="dark" style="margin-bottom:10px;font-size:1.2em">
          {totalText}
        </div>
        <Pagination
          page={page}
          total={data.total}
          perPage={perPage}
          basePath={`/user_topics/${username}`}
        />
        {data.items.length ? (
          <ThreadList items={data.items} />
        ) : (
          <div style="margin:20px 0;font-size:1.3em">Пока нет ни одного топика.</div>
        )}
        <Pagination
          page={page}
          total={data.total}
          perPage={perPage}
          basePath={`/user_topics/${username}`}
        />
      </div>
    ),
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

export default app;