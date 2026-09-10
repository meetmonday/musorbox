import { Hono } from "hono";
import type { Context } from "hono";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { layoutWithSidebar } from "../layout/layout";
import {
  getUserByUsername,
  getRatingFor,
  getTopicsByAuthor,
  updateUserProfile,
} from "./service";
import { ProfilePage } from "./components";
import { ThreadList } from "../forum/components";
import { Pagination } from "../topics/components";
import { RecentDiscussions, NewOnSite, HotTopics, SidebarAd } from "../sidebar/components";
import { getHotTopics, getRecentDiscussions, getRecentTopics } from "../topics/service";
import { pluralize } from "../core/utils";

const app = new Hono<{ Variables: UserContext }>();

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
  const profile = await getUserByUsername(username);
  if (!profile) return c.notFound();

  const current = c.get("user") ?? null;
  const isOwner = current?.id === profile.id;
  const [rating, sidebar] = await Promise.all([
    getRatingFor(profile.id, profile.ratingOptout),
    renderSidebar(),
  ]);

  const html = await layoutWithSidebar({
    title: `Профиль — ${config.siteName}`,
    user: current,
    sidebar,
    children: <ProfilePage profile={profile} rating={rating} isOwner={isOwner} />,
  });
  return c.html(`<!DOCTYPE html>${html}`);
}

async function handleProfileEdit(c: AppContext) {
  const username = c.req.param("username") as string;
  const profile = await getUserByUsername(username);
  if (!profile) return c.notFound();

  const current = c.get("user") ?? null;
  const isOwner = current?.id === profile.id;
  const isStaff = current && (current.role === "editor" || current.role === "admin");
  if (!isOwner && !isStaff) {
    return c.redirect(`/users/${username}/`);
  }

  const body = await c.req.parseBody();
  const edit = body["edit_profile"];
  if (edit !== "1") return c.redirect(`/users/${username}/`);

  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  await updateUserProfile(username, {
    fullName: str(body["full_name"]) ?? str(body["fullname"]),
    country: str(body["country"]),
    city: str(body["city"]),
    vkUrl: str(body["vk"]),
    twitterUrl: str(body["twitter"]),
    skype: str(body["skype"]),
    devices: str(body["devices"]),
  });
  return c.redirect(`/users/${username}/`);
}

app.get("/users/:username", handleProfile);
app.get("/users/:username/", handleProfile);

app.post("/users/:username", handleProfileEdit);
app.post("/users/:username/", handleProfileEdit);

app.get("/user_topics/:username", getTopicsPage);
app.get("/user_topics/:username/", getTopicsPage);

async function getTopicsPage(c: AppContext) {
  const username = c.req.param("username") as string;
  const page = Number(c.req.query("page") ?? 1) || 1;
  const profile = await getUserByUsername(username);
  if (!profile) return c.notFound();

  const [data, sidebar] = await Promise.all([
    getTopicsByAuthor(username, page, perPage),
    renderSidebar(),
  ]);
  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const totalText = `${data.total} ${pluralize(data.total, "топик", "топика", "топиков")}`;

  const html = await layoutWithSidebar({
    title: `Все топики ${username} — ${config.siteName}`,
    user: c.get("user") ?? null,
    sidebar,
    children: (
      <div>
        <h1 class="h_page_header">Все топики: {username}</h1>
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