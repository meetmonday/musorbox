import { getDrizzle } from "../core/db";
import { topics, categories, users, tags, topicTags, comments } from "../core/schema";
import { and, desc, eq, sql, count } from "drizzle-orm";

export type TopicListItem = {
  id: number;
  title: string;
  slug: string;
  body: string;
  leadImage: string | null;
  votesUp: number;
  votesDown: number;
  commentCount: number;
  createdAt: Date;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  authorId: number;
  authorUsername: string;
  authorAvatar: string | null;
  tags: { id: number; name: string; slug: string }[];
};

export type TopicDetail = TopicListItem & {
  categoryType: string;
  isPinned: boolean;
  views: number;
};

type TopicRow = {
  topics_id: number;
  topics_title: string;
  topics_slug: string;
  topics_body: string;
  topics_lead_image: string | null;
  topics_votes_up: number;
  topics_votes_down: number;
  topics_comment_count: number;
  topics_created_at: Date;
  topics_is_pinned: boolean;
  topics_views: number;
  category_id: number;
  category_slug: string;
  category_name: string;
  category_type: string;
  user_id: number;
  user_username: string;
  user_avatar_url: string | null;
  tags: { id: number; name: string; slug: string }[];
};

export function mapTopicRow(r: Omit<TopicRow, "tags">): TopicListItem {
  return {
    id: r.topics_id,
    title: r.topics_title,
    slug: r.topics_slug,
    body: r.topics_body,
    leadImage: r.topics_lead_image,
    votesUp: r.topics_votes_up,
    votesDown: r.topics_votes_down,
    commentCount: r.topics_comment_count,
    createdAt: r.topics_created_at,
    categoryId: r.category_id,
    categorySlug: r.category_slug,
    categoryName: r.category_name,
    authorId: r.user_id,
    authorUsername: r.user_username,
    authorAvatar: r.user_avatar_url,
    tags: [],
  };
}

export function mapTopicDetail(r: Omit<TopicRow, "tags">): TopicDetail {
  return {
    ...mapTopicRow(r),
    categoryType: r.category_type,
    isPinned: r.topics_is_pinned,
    views: r.topics_views,
  };
}

export const topicSelect = {
  topics_id: topics.id,
  topics_title: topics.title,
  topics_slug: topics.slug,
  topics_body: topics.body,
  topics_lead_image: topics.leadImage,
  topics_votes_up: topics.votesUp,
  topics_votes_down: topics.votesDown,
  topics_comment_count: topics.commentCount,
  topics_created_at: topics.createdAt,
  topics_is_pinned: topics.isPinned,
  topics_views: topics.views,
  category_id: categories.id,
  category_slug: categories.slug,
  category_name: categories.name,
  category_type: categories.type,
  user_id: users.id,
  user_username: users.username,
  user_avatar_url: users.avatarUrl,
};

export async function getTopicsByCategory(
  categorySlug?: string,
  page: number = 1,
  limit: number = 10,
): Promise<{ items: TopicListItem[]; total: number }> {
  const db = getDrizzle();
  const pageNum = Math.max(1, page);

  const base = db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(categorySlug ? eq(categories.slug, categorySlug) : sql`1=1`)
    .orderBy(desc(topics.createdAt))
    .$dynamic();

  const totalSel = db
    .select({ n: count(topics.id) })
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .where(categorySlug ? eq(categories.slug, categorySlug) : sql`1=1`);

  const [rows, totalRows] = await Promise.all([
    base.limit(limit).offset((pageNum - 1) * limit),
    totalSel,
  ]);

  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return { items, total: totalRows[0]?.n ?? 0 };
}

export async function getTopicBySlug(id: number, slug?: string): Promise<TopicDetail | null> {
  const db = getDrizzle();
  const rows = await db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(and(eq(topics.id, id), slug ? eq(topics.slug, slug) : sql`1=1`))
    .limit(1);

  if (!rows[0]) return null;
  const detail = mapTopicDetail(rows[0]);
  await attachTags([detail]);
  await db.update(topics).set({ views: sql`${topics.views} + 1` }).where(eq(topics.id, id));
  return detail;
}

export async function getTopicById(id: number): Promise<TopicDetail | null> {
  return getTopicBySlug(id);
}

export async function getFeaturedTopics(limit: number = 5): Promise<TopicListItem[]> {
  const db = getDrizzle();
  const rows = await db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .orderBy(desc(topics.commentCount))
    .limit(limit);
  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return items;
}

export async function getRecentTopics(limit: number = 8): Promise<SidebarTopic[]> {
  const db = getDrizzle();
  const rows = await db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .orderBy(desc(topics.createdAt))
    .limit(limit);
  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return withLastCommenters(items);
}

export type SidebarTopic = TopicListItem & {
  replier: string | null;
  replierAvatar: string | null;
  replierSubject: string;
};

async function lastReplyMap(
  topicIds: number[],
  topicAuthorByTopic: Map<number, string>,
): Promise<
  Map<
    number,
    { replier: string | null; replierAvatar: string | null; subject: string }
  >
> {
  const result = new Map<
    number,
    { replier: string | null; replierAvatar: string | null; subject: string }
  >();
  if (topicIds.length === 0) return result;
  const db = getDrizzle();

  const placeholders = sql.join(topicIds.map((id) => sql`${id}`), sql`, `);
  const lastComments = await db
    .select({
      id: comments.id,
      topicId: comments.topicId,
      parentId: comments.parentId,
      replier: users.username,
      replierAvatar: users.avatarUrl,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      sql`${comments.id} IN (SELECT MAX(id) FROM comments WHERE ${comments.topicId} IN (${placeholders}) GROUP BY ${comments.topicId})`,
    );

  const parentIds = lastComments
    .map((c) => c.parentId)
    .filter((p): p is number => p !== null);
  let parentAuthorByComment = new Map<number, string>();
  if (parentIds.length > 0) {
    const parentRows = await db
      .select({ id: comments.id, username: users.username })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(
        sql`${comments.id} IN (${sql.join(parentIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    parentAuthorByComment = new Map(parentRows.map((r) => [r.id, r.username]));
  }

  for (const c of lastComments) {
    const subject =
      c.parentId !== null
        ? parentAuthorByComment.get(c.parentId) ?? topicAuthorByTopic.get(c.topicId) ?? ""
        : topicAuthorByTopic.get(c.topicId) ?? "";
    result.set(c.topicId, {
      replier: c.replier,
      replierAvatar: c.replierAvatar,
      subject,
    });
  }
  return result;
}

async function withLastCommenters(
  items: TopicListItem[],
): Promise<SidebarTopic[]> {
  const authorByTopic = new Map(items.map((i) => [i.id, i.authorUsername]));
  const map = await lastReplyMap(
    items.map((i) => i.id),
    authorByTopic,
  );
  return items.map((i) => {
    const info = map.get(i.id);
    return {
      ...i,
      replier: info?.replier ?? null,
      replierAvatar: info?.replierAvatar ?? null,
      replierSubject: info?.subject ?? i.authorUsername,
    };
  });
}

export async function getHotTopics(limit: number = 8): Promise<SidebarTopic[]> {
  const db = getDrizzle();
  const rows = await db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(sql`${topics.commentCount} > 0`)
    .orderBy(desc(topics.commentCount), desc(topics.votesUp))
    .limit(limit);
  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return withLastCommenters(items);
}

export async function getRecentDiscussions(limit: number = 8): Promise<SidebarTopic[]> {
  const db = getDrizzle();
  const latestIds = await db
    .select({ topicId: comments.topicId })
    .from(comments)
    .groupBy(comments.topicId)
    .orderBy(desc(sql`max(${comments.id})`))
    .limit(limit);
  if (latestIds.length === 0) return [];

  const ids = latestIds.map((r) => r.topicId);
  const rows = await db
    .select(topicSelect)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(sql`${topics.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  const byId = new Map(rows.map((r) => [r.topics_id, r] as const));
  const ordered: Omit<TopicRow, "tags">[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) ordered.push(r);
  }
  const items = ordered.map(mapTopicRow);
  await attachTags(items);
  return withLastCommenters(items);
}

export async function getLeaderboard(): Promise<{
  authors: { id: number; username: string; avatar: string | null; score: number }[];
  commenters: { id: number; username: string; avatar: string | null; score: number }[];
}> {
  const db = getDrizzle();
  const authors = await db
    .select({ id: users.id, username: users.username, avatar: users.avatarUrl, score: count(topics.id) })
    .from(topics)
    .innerJoin(users, eq(users.id, topics.authorId))
    .groupBy(users.id)
    .orderBy(desc(count(topics.id)))
    .limit(5);

  const commenters = await db
    .select({ id: users.id, username: users.username, avatar: users.avatarUrl, score: count(comments.id) })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .groupBy(users.id)
    .orderBy(desc(count(comments.id)))
    .limit(5);

  return { authors, commenters };
}

export async function attachTags(items: TopicListItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = getDrizzle();
  const ids = items.map((i) => i.id);
  const rows = await db
    .select({
      topicId: topicTags.topicId,
      tagId: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(sql`${topicTags.topicId} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  const byTopic = new Map<number, { id: number; name: string; slug: string }[]>();
  for (const r of rows) {
    const list = byTopic.get(r.topicId) ?? [];
    list.push({ id: r.tagId, name: r.name, slug: r.slug });
    byTopic.set(r.topicId, list);
  }
  for (const item of items) {
    item.tags = byTopic.get(item.id) ?? [];
  }
}

export type EditableCategory = {
  id: number;
  name: string;
  slug: string;
};

export async function getEditableCategories(): Promise<EditableCategory[]> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(sql`${categories.slug} != 'index'`)
    .orderBy(categories.sortOrder);
  return rows;
}

export async function uniqueSlug(base: string): Promise<string> {
  const db = getDrizzle();
  for (let i = 1; i <= 1000; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const rows = await db.select({ id: topics.id }).from(topics).where(eq(topics.slug, slug)).limit(1);
    if (!rows[0]) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createTopic(input: {
  title: string;
  slug: string;
  body: string;
  categoryId: number;
  authorId: number;
  leadImage: string | null;
  tagIds: number[];
}): Promise<number> {
  const db = getDrizzle();
  const now = new Date();
  const rows = await db
    .insert(topics)
    .values({
      title: input.title,
      slug: input.slug,
      body: input.body,
      categoryId: input.categoryId,
      authorId: input.authorId,
      leadImage: input.leadImage,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: topics.id });
  const id = rows[0]!.id;
  if (input.tagIds.length) {
    await db.insert(topicTags).values(input.tagIds.map((tagId) => ({ topicId: id, tagId })));
  }
  return id;
}

export async function deleteTopic(id: number): Promise<void> {
  const db = getDrizzle();
  await db.delete(topics).where(eq(topics.id, id));
}