import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name"),
    role: text("role", { enum: ["user", "author", "editor", "admin"] })
      .notNull()
      .default("user"),
    avatarUrl: text("avatar_url"),
    country: text("country"),
    city: text("city"),
    vkUrl: text("vk_url"),
    twitterUrl: text("twitter_url"),
    skype: text("skype"),
    devices: text("devices"),
    ratingOptout: integer("rating_optout", { mode: "boolean" }).notNull().default(false),
    wasEverAuthor: integer("was_ever_author", { mode: "boolean" }).notNull().default(false),
    wasEverCommenter: integer("was_ever_commenter", { mode: "boolean" }).notNull().default(false),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_username_idx").on(t.username)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").references((): any => categories.id),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    type: text("type", { enum: ["text", "forum", "news", "reviews", "progs", "games", "themes"] })
      .notNull()
      .default("text"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const topics = sqliteTable(
  "topics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    body: text("body").notNull(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    leadImage: text("lead_image"),
    votesUp: integer("votes_up").notNull().default(0),
    votesDown: integer("votes_down").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    views: integer("views").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("topics_id_slug_idx").on(t.id, t.slug),
    index("topics_category_idx").on(t.categoryId),
    index("topics_author_idx").on(t.authorId),
    index("topics_created_idx").on(t.createdAt),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    group: text("group", { enum: ["os", "quest", "common"] }).notNull().default("common"),
    weight: integer("weight").notNull().default(0),
  },
  (t) => [uniqueIndex("tags_slug_idx").on(t.slug)],
);

export const topicTags = sqliteTable(
  "topic_tags",
  {
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.topicId, t.tagId] }),
    index("topic_tags_tag_idx").on(t.tagId),
  ],
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): any => comments.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    votesUp: integer("votes_up").notNull().default(0),
    votesDown: integer("votes_down").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_topic_idx").on(t.topicId),
    index("comments_parent_idx").on(t.parentId),
    index("comments_author_idx").on(t.authorId),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    entityType: text("entity_type", { enum: ["topic", "comment"] }).notNull(),
    entityId: integer("entity_id").notNull(),
    value: integer("value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityType, t.entityId] }),
    index("votes_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const firms = sqliteTable(
  "firms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
  },
  (t) => [uniqueIndex("firms_name_idx").on(t.name)],
);