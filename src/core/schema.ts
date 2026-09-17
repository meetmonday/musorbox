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
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    banReason: text("ban_reason"),
    bannedAt: integer("banned_at", { mode: "timestamp_ms" }),
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
    last_seen_at: integer("last_seen_at", { mode: "timestamp_ms" }),
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
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
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
    authorId: integer("author_id").references(() => users.id),
    remoteActorId: integer("remote_actor_id").references(() => apActors.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    apUrl: text("ap_url"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
    votesUp: integer("votes_up").notNull().default(0),
    votesDown: integer("votes_down").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_topic_idx").on(t.topicId),
    index("comments_parent_idx").on(t.parentId),
    index("comments_author_idx").on(t.authorId),
    index("comments_remote_actor_idx").on(t.remoteActorId),
    index("comments_ap_url_idx").on(t.apUrl),
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

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
  remoteActorId: integer("remote_actor_id").references(() => apActors.id, { onDelete: "set null" }),
  type: text("type", { enum: ["reply", "topic_reply", "mention", "like", "mod"] }).notNull(),
  topicId: integer("topic_id").references(() => topics.id, { onDelete: "cascade" }),
  commentId: integer("comment_id").references(() => comments.id, { onDelete: "cascade" }),
  message: text("message"),
  eventKey: text("event_key").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
}, (t) => [
  index("notifications_user_read_idx").on(t.userId, t.read),
  uniqueIndex("notifications_event_idx").on(t.userId, t.eventKey),
]);

export const modLog = sqliteTable("mod_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moderatorId: integer("moderator_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type", { enum: ["topic", "comment", "user"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  reason: text("reason").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
}, (t) => [index("mod_log_created_idx").on(t.createdAt)]);

export const firms = sqliteTable(
  "firms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
  },
  (t) => [uniqueIndex("firms_name_idx").on(t.name)],
);

/* ─── ActivityPub tables ─── */

export const apKeys = sqliteTable(
  "ap_keys",
  {
    userId: integer("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    privateKeyPem: text("private_key_pem").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
);

export const apActors = sqliteTable(
  "ap_actors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    remoteId: text("remote_id").notNull(),
    preferredUsername: text("preferred_username").notNull(),
    host: text("host").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    inboxUrl: text("inbox_url"),
    sharedInboxUrl: text("shared_inbox_url"),
    publicKeyPem: text("public_key_pem").notNull(),
    localUserId: integer("local_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("ap_actors_remote_id_idx").on(t.remoteId),
    index("ap_actors_host_idx").on(t.host),
    index("ap_actors_local_user_idx").on(t.localUserId),
  ],
);

export const apFollowers = sqliteTable(
  "ap_followers",
  {
    localUserId: integer("local_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => apActors.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.localUserId, t.actorId] }),
    index("ap_followers_actor_idx").on(t.actorId),
  ],
);

export const apFollowing = sqliteTable(
  "ap_following",
  {
    localUserId: integer("local_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => apActors.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["requested", "accepted"] })
      .notNull()
      .default("requested"),
    followIri: text("follow_iri"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.localUserId, t.actorId] }),
    index("ap_following_actor_idx").on(t.actorId),
  ],
);

export const apActivities = sqliteTable(
  "ap_activities",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    actorId: integer("actor_id").references(() => apActors.id, { onDelete: "cascade" }),
    object: text("object"),
    targetId: text("target_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
);

export const apReactions = sqliteTable(
  "ap_reactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => apActors.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["Like", "Announce"] }).notNull(),
    objectUrl: text("object_url").notNull(),
    activityId: text("activity_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ap_reactions_actor_type_object_idx").on(t.actorId, t.type, t.objectUrl),
    index("ap_reactions_object_idx").on(t.objectUrl),
    index("ap_reactions_activity_idx").on(t.activityId),
  ],
);

export const apMentions = sqliteTable(
  "ap_mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => apActors.id, { onDelete: "cascade" }),
    targetLocalUserId: integer("target_local_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objectUrl: text("object_url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ap_mentions_actor_target_object_idx").on(t.actorId, t.targetLocalUserId, t.objectUrl),
    index("ap_mentions_target_user_idx").on(t.targetLocalUserId),
  ],
);