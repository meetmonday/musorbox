import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { getDb } from "./core/db";
import { config } from "./core/config";
import { sessionMiddleware } from "./core/middleware";
import type { UserContext } from "./core/middleware";
import topicsRoutes from "./topics/routes";
import authRoutes from "./auth/routes";
import forumRoutes from "./forum/routes";
import votesRoutes from "./votes/routes";

type AppEnv = {
  Variables: UserContext;
};

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", sessionMiddleware);
app.use("/css/*", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));
app.use("/js/*", serveStatic({ root: "./public" }));
app.use("/avatars/*", serveStatic({ root: "./public" }));

app.route("/", topicsRoutes);
app.route("/", authRoutes);
app.route("/", forumRoutes);
app.route("/", votesRoutes);

app.all("*", (c) => c.text("Not found", 404));

getDb();
console.log(`[trashbox] DB initialized at ${config.dbPath}`);

Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`[trashbox] serving on http://localhost:${config.port}`);