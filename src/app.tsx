import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { getDb, getDrizzle } from "./core/db";
import { inArray, sql } from "drizzle-orm";
import { users } from "./core/schema";
import { config } from "./core/config";
import { sessionMiddleware } from "./core/middleware";
import type { UserContext } from "./core/middleware";
import topicsRoutes from "./topics/routes";
import authRoutes from "./auth/routes";
import forumRoutes from "./forum/routes";
import votesRoutes from "./votes/routes";
import usersRoutes from "./users/routes";
import editorRoutes from "./editor/routes";
import pagesRoutes from "./pages/routes";
import activityPubRoutes from "./activitypub/routes";
import notificationsRoutes from "./notifications/routes";
import moderationRoutes from "./moderation/routes";
import apiRoutes from "./api/routes";
import apiSettingsRoutes from "./api/settings";

type AppEnv = {
  Variables: UserContext;
};

const app = new Hono<AppEnv>({ strict: false });

app.use("*", logger());
app.use("*", sessionMiddleware);
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));
app.use("/img/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));
app.use("/avatars/*", serveStatic({ root: "./public" }));
app.use("/Bredacture/*", serveStatic({ root: "./public" }));
app.use("/uploads/*", serveStatic({ root: "./public" }));

app.route("/", activityPubRoutes);
app.route("/", apiRoutes);
app.route("/", apiSettingsRoutes);
app.route("/", topicsRoutes);
app.route("/", authRoutes);
app.route("/", forumRoutes);
app.route("/", votesRoutes);
app.route("/", usersRoutes);
app.route("/", editorRoutes);
app.route("/", pagesRoutes);
app.route("/", notificationsRoutes);
app.route("/", moderationRoutes);

app.all("*", (c) => c.text("Not found", 404));

getDb();
console.log(`[musorbox] DB initialized at ${config.dbPath}`);

if (config.adminUsernames.length > 0) {
  const promoted = getDrizzle()
    .update(users)
    .set({ role: "admin" })
    .where(inArray(sql`lower(${users.username})`, config.adminUsernames))
    .returning({ id: users.id })
    .all();
  if (promoted.length > 0) {
    console.log(`[musorbox] forced admin: ${promoted.length} user(s) promoted to admin (ADMIN_USERNAME)`);
  }
}

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`[musorbox] serving on http://localhost:${config.port}`);