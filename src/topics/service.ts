import { getDb, getDrizzle } from "../core/db";
import { topics, categories, users, tags, topicTags, comments, apActors } from "../core/schema";
import { and, desc, eq, inArray, sql, count } from "drizzle-orm";
import { config } from "../core/config";
import { notifyTopicCreated, notifyTopicDeleted, notifyTopicUpdated } from "../activitypub/notify";

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
  hidden: boolean;
  views: number;
  updatedAt?: Date | null;
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
  topics_hidden: boolean;
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
    hidden: r.topics_hidden,
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
  topics_hidden: topics.hidden,
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
    .where(sql`(${categorySlug ? eq(categories.slug, categorySlug) : sql`1=1`}) AND ${topics.hidden} = 0`)
    .orderBy(desc(topics.createdAt))
    .$dynamic();

  const totalSel = db
    .select({ n: count(topics.id) })
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .where(sql`(${categorySlug ? eq(categories.slug, categorySlug) : sql`1=1`}) AND ${topics.hidden} = 0`);

  const [rows, totalRows] = await Promise.all([
    base.limit(limit).offset((pageNum - 1) * limit),
    totalSel,
  ]);

  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return { items: await withLastCommenters(items), total: totalRows[0]?.n ?? 0 };
}

export async function searchTopics(query: string, page: number, limit: number) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { items: [], total: 0, page: 1 };
  const db = getDrizzle();
  const requested = Math.max(1, Number.isSafeInteger(page) ? page : 1);
  const { rows, total, current } = db.transaction((tx) => {
    // SQLite lower()/LIKE не учитывают регистр кириллицы. Читаем по одной
    // записи, сохраняя только ID нужной и последней страниц, без HTML всей ленты.
    const candidates = getDb().query<{ id: number; title: string; body: string }, []>(`
      SELECT topics.id, topics.title, topics.body FROM topics
      INNER JOIN categories ON categories.id = topics.category_id
      INNER JOIN users ON users.id = topics.author_id
      WHERE topics.hidden = 0 ORDER BY topics.created_at DESC, topics.id DESC
    `);
    let total = 0;
    const selected: number[] = [];
    let lastPage: number[] = [];
    for (const topic of candidates.iterate()) {
      if (!topic.title.toLowerCase().includes(needle) && !topic.body.toLowerCase().includes(needle)) continue;
      if (total % limit === 0) lastPage = [];
      lastPage.push(topic.id);
      if (Math.floor(total / limit) + 1 === requested) selected.push(topic.id);
      total++;
    }
    const current = Math.min(requested, Math.max(1, Math.ceil(total / limit)));
    const ids = selected.length ? selected : lastPage;
    const rows = ids.length ? tx.select(topicSelect).from(topics)
      .innerJoin(categories, eq(categories.id, topics.categoryId))
      .innerJoin(users, eq(users.id, topics.authorId))
      .where(inArray(topics.id, ids)).orderBy(desc(topics.createdAt), desc(topics.id)).all() : [];
    return { rows, total, current };
  });
  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return { items, total, page: current };
}

export type SidebarTopic = TopicListItem & {
  replier: string | null;
  replierUrl: string | null;
  replierAvatar: string | null;
  replierSubject: string;
  replierSubjectUrl: string | null;
};

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
    .where(eq(topics.hidden, false))
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
    .where(eq(topics.hidden, false))
    .orderBy(desc(topics.createdAt))
    .limit(limit);
  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return withLastCommenters(items);
}

type PooledAuthorRow = {
  localUsername: string | null;
  localAvatar: string | null;
  remoteId: number | null;
  remoteUsername: string | null;
  remoteHost: string | null;
  remoteAvatar: string | null;
  remoteIri: string | null;
  remoteDeletedAt: Date | null;
};

type AuthorInfo = { name: string; url: string; avatar: string | null };

function localAuthorInfo(username: string, avatar: string | null): AuthorInfo {
  return { name: username, url: `/users/${username}/`, avatar };
}

/** Resolve a comment author (local user or remote actor) into display info. */
function pooledAuthorInfo(r: PooledAuthorRow): AuthorInfo | null {
  if (r.remoteId != null && !r.remoteDeletedAt) {
    const nick = r.remoteUsername ?? "remote";
    return {
      name: r.remoteHost ? `@${nick}@${r.remoteHost}` : nick,
      url: r.remoteIri ?? "",
      avatar: r.remoteAvatar ?? null,
    };
  }
  if (r.localUsername) return localAuthorInfo(r.localUsername, r.localAvatar);
  return null;
}

async function lastReplyMap(
  topicIds: number[],
  topicAuthorByTopic: Map<number, string>,
): Promise<Map<number, { replier: AuthorInfo | null; subject: AuthorInfo | null }>> {
  const result = new Map<number, { replier: AuthorInfo | null; subject: AuthorInfo | null }>();
  if (topicIds.length === 0) return result;
  const db = getDrizzle();

  const placeholders = sql.join(topicIds.map((id) => sql`${id}`), sql`, `);
  const lastComments = await db
    .select({
      id: comments.id,
      topicId: comments.topicId,
      parentId: comments.parentId,
      localUsername: users.username,
      localAvatar: users.avatarUrl,
      remoteId: apActors.id,
      remoteUsername: apActors.preferredUsername,
      remoteHost: apActors.host,
      remoteAvatar: apActors.avatarUrl,
      remoteIri: apActors.remoteId,
      remoteDeletedAt: apActors.deletedAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
    .where(
      sql`${comments.id} IN (SELECT MAX(id) FROM comments WHERE ${comments.topicId} IN (${placeholders}) GROUP BY ${comments.topicId})`,
    );

  const parentIds = lastComments
    .map((c) => c.parentId)
    .filter((p): p is number => p !== null);
  let parentAuthorByComment = new Map<number, AuthorInfo>();
  if (parentIds.length > 0) {
    const parentRows = await db
      .select({
        parentCommentId: comments.id,
        localUsername: users.username,
        localAvatar: users.avatarUrl,
        remoteId: apActors.id,
        remoteUsername: apActors.preferredUsername,
        remoteHost: apActors.host,
        remoteAvatar: apActors.avatarUrl,
        remoteIri: apActors.remoteId,
        remoteDeletedAt: apActors.deletedAt,
      })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
      .where(
        sql`${comments.id} IN (${sql.join(parentIds.map((id) => sql`${id}`), sql`, `)})`,
      );
    for (const r of parentRows) {
      const info = pooledAuthorInfo(r);
      if (info) parentAuthorByComment.set(r.parentCommentId, info);
    }
  }

  for (const row of lastComments) {
    const replier = pooledAuthorInfo(row);
    let subject: AuthorInfo | null;
    if (row.parentId !== null) {
      subject =
        parentAuthorByComment.get(row.parentId) ??
        (() => {
          const ta = topicAuthorByTopic.get(row.topicId);
          return ta ? localAuthorInfo(ta, null) : null;
        })();
    } else {
      const ta = topicAuthorByTopic.get(row.topicId);
      subject = ta ? localAuthorInfo(ta, null) : null;
    }
    result.set(row.topicId, { replier, subject });
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
      replier: info?.replier?.name ?? null,
      replierUrl: info?.replier?.url ?? null,
      replierAvatar: info?.replier?.avatar ?? null,
      replierSubject: info?.subject?.name ?? i.authorUsername,
      replierSubjectUrl: info?.subject?.url ?? null,
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
    .where(sql`${topics.commentCount} > 0 AND ${topics.hidden} = 0`)
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
    .innerJoin(topics, eq(topics.id, comments.topicId))
    .where(eq(topics.hidden, false))
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
    .where(sql`${topics.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) AND ${topics.hidden} = 0`);
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

export type LeaderboardEntry = {
  id: number;
  kind: "local" | "remote";
  username: string;
  url: string;
  avatar: string | null;
  score: number;
};

export async function getLeaderboard(): Promise<{
  authors: LeaderboardEntry[];
  commenters: LeaderboardEntry[];
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
    .select({
      localId: users.id,
      localUsername: users.username,
      localAvatar: users.avatarUrl,
      remoteId: apActors.id,
      remoteUsername: apActors.preferredUsername,
      remoteHost: apActors.host,
      remoteAvatar: apActors.avatarUrl,
      remoteIri: apActors.remoteId,
      remoteDeletedAt: apActors.deletedAt,
      score: count(comments.id),
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .leftJoin(apActors, eq(apActors.id, comments.remoteActorId))
    .groupBy(comments.authorId, comments.remoteActorId)
    .orderBy(desc(count(comments.id)))
    .limit(5);

  return {
    authors: authors.map((a) => ({
      id: a.id,
      kind: "local" as const,
      username: a.username,
      url: `/users/${a.username}/`,
      avatar: a.avatar,
      score: a.score,
    })),
    commenters: commenters
      .map((c) => {
        const info = pooledAuthorInfo(c);
        if (!info) return null;
        return {
          id: c.remoteId ?? c.localId ?? 0,
          kind: (c.remoteId != null ? "remote" : "local") as "local" | "remote",
          username: info.name,
          url: info.url,
          avatar: info.avatar,
          score: c.score,
        };
      })
      .filter((x): x is LeaderboardEntry => x !== null),
  };
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
  void notifyTopicCreated(id, input.authorId);
  return id;
}

export async function deleteTopic(id: number): Promise<void> {
  const db = getDrizzle();
  const topic = await db.select({ authorId: topics.authorId, slug: topics.slug }).from(topics).where(eq(topics.id, id)).limit(1);
  await db.delete(topics).where(eq(topics.id, id));
  if (topic[0]) {
    const url = topic[0].slug ? `${config.baseUrl}/topics/${id}/${topic[0].slug}` : `${config.baseUrl}/topics/${id}`;
    void notifyTopicDeleted(id, topic[0].authorId, url);
  }
}

export async function updateTopic(
  id: number,
  input: {
    title: string;
    body: string;
    categoryId: number;
    leadImage: string | null;
    tagIds: number[];
  },
): Promise<void> {
  const db = getDrizzle();
  await db
    .update(topics)
    .set({
      title: input.title,
      body: input.body,
      categoryId: input.categoryId,
      leadImage: input.leadImage,
      updatedAt: new Date(),
    })
    .where(eq(topics.id, id));
  await db.delete(topicTags).where(eq(topicTags.topicId, id));
  if (input.tagIds.length) {
    await db.insert(topicTags).values(input.tagIds.map((tagId) => ({ topicId: id, tagId })));
  }
  void notifyTopicUpdated(id);
}