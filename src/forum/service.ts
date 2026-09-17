import { getDrizzle } from "../core/db";
import { tags, topicTags, topics, categories, users } from "../core/schema";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { TopicListItem } from "../topics/service";
import { mapTopicRow, attachTags } from "../topics/service";

const forumSlug = "b_questions";

export type TagGroup = { id: number; name: string; slug: string; group: string; weight: number };

export async function getForumTags(): Promise<{ os: TagGroup[]; quest: TagGroup[] }> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: tags.id, name: tags.name, slug: tags.slug, group: tags.group, weight: tags.weight })
    .from(tags)
    .where(sql`${tags.group} IN ('os', 'quest')`)
    .orderBy(tags.name);
  const os: TagGroup[] = [];
  const quest: TagGroup[] = [];
  for (const r of rows) {
    if (r.group === "os") os.push(r);
    else if (r.group === "quest") quest.push(r);
  }
  return { os, quest };
}

export async function getForumThreads(
  tagSlug?: string,
  page: number = 1,
  limit: number = 20,
): Promise<{ items: TopicListItem[]; total: number }> {
  const db = getDrizzle();
  const pageNum = Math.max(1, page);

  const selectBase = {
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

  const base = db
    .select(selectBase)
    .from(topics)
    .innerJoin(categories, eq(categories.id, topics.categoryId))
    .innerJoin(users, eq(users.id, topics.authorId))
    .where(and(eq(categories.slug, forumSlug), eq(topics.hidden, false)))
    .orderBy(desc(topics.createdAt))
    .$dynamic();

  async function totalCount(): Promise<number> {
    const countQuery = db
      .select({ n: count(topics.id) })
      .from(topics)
      .innerJoin(categories, eq(categories.id, topics.categoryId));
    if (tagSlug) {
      const tag = await getTagBySlug(tagSlug);
      if (!tag) return 0;
      countQuery.leftJoin(topicTags, eq(topicTags.topicId, topics.id)).where(
        and(eq(categories.slug, forumSlug), eq(topicTags.tagId, tag.id), eq(topics.hidden, false)),
      );
    } else {
      countQuery.where(and(eq(categories.slug, forumSlug), eq(topics.hidden, false)));
    }
    const r = await countQuery;
    return r[0]?.n ?? 0;
  }

  if (tagSlug) {
    const tag = await getTagBySlug(tagSlug);
    if (!tag) return { items: [], total: 0 };
    base
      .leftJoin(topicTags, eq(topicTags.topicId, topics.id))
      .where(and(eq(categories.slug, forumSlug), eq(topicTags.tagId, tag.id), eq(topics.hidden, false)));
  }

  const [rows, total] = await Promise.all([
    base.limit(limit).offset((pageNum - 1) * limit),
    totalCount(),
  ]);

  const items = rows.map(mapTopicRow) as TopicListItem[];
  await attachTags(items);
  return { items, total };
}

export async function getThreadTags(topicId: number): Promise<TagGroup[]> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: tags.id, name: tags.name, slug: tags.slug, group: tags.group, weight: tags.weight })
    .from(topicTags)
    .innerJoin(tags, eq(tags.id, topicTags.tagId))
    .where(eq(topicTags.topicId, topicId));
  return rows;
}

async function getTagBySlug(slug: string): Promise<TagGroup | null> {
  const db = getDrizzle();
  const rows = await db
    .select({ id: tags.id, name: tags.name, slug: tags.slug, group: tags.group, weight: tags.weight })
    .from(tags)
    .where(eq(tags.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getTagBySlugPublic(slug: string): Promise<TagGroup | null> {
  return getTagBySlug(slug);
}