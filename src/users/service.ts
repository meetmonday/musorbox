import { getDrizzle } from "../core/db";
import { users, topics, comments, categories } from "../core/schema";
import { eq, sql, desc, count } from "drizzle-orm";
import { notifyProfileUpdated } from "../activitypub/notify";
import type { TopicListItem } from "../topics/service";
import { mapTopicRow, attachTags, topicSelect } from "../topics/service";
import { hydrateAuthorHandles, hydrateHandles } from "../core/utils";

export type UserProfile = {
  id: number;
  username: string;
  fullName: string | null;
  role: string;
  avatarUrl: string | null;
  country: string | null;
  city: string | null;
  vkUrl: string | null;
  twitterUrl: string | null;
  skype: string | null;
  devices: string | null;
  ratingOptout: boolean;
  createdAt: Date;
  lastSeenAt: Date | null;
  topicsCount: number;
  discussedTopics: number;
  commentsCount: number;
  handle?: string | null;
};

export async function getUserByUsername(username: string): Promise<UserProfile | null> {
  const db = getDrizzle();
  const row = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (!row) return null;

  const [topicsCount, discussed, commentsCount] = await Promise.all([
    db
      .select({ n: count(topics.id) })
      .from(topics)
      .where(eq(topics.authorId, row.id))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(distinct ${comments.topicId})` })
      .from(comments)
      .where(eq(comments.authorId, row.id))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count(comments.id) })
      .from(comments)
      .where(eq(comments.authorId, row.id))
      .then((r) => r[0]?.n ?? 0),
  ]);

  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    avatarUrl: row.avatarUrl,
    country: row.country,
    city: row.city,
    vkUrl: row.vkUrl,
    twitterUrl: row.twitterUrl,
    skype: row.skype,
    devices: row.devices,
    ratingOptout: row.ratingOptout,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    topicsCount,
    discussedTopics: discussed,
    commentsCount,
  };
}

export async function getUserByUsernameWithHandle(username: string): Promise<UserProfile | null> {
  const profile = await getUserByUsername(username);
  if (!profile) return null;
  return (await hydrateHandles([profile]))[0] ?? profile;
}

export type RatingEntry = {
  userId: number;
  username: string;
  votes: number;
  net: number;
};

type RatingBucket = { contest: RatingEntry[]; overall: RatingEntry[] };

export async function getUserRatings(): Promise<RatingBucket> {
  const db = getDrizzle();

  const [topicStats, commentStats, opts, userRows] = await Promise.all([
    db
      .select({
        userId: topics.authorId,
        up: sql<number>`sum(${topics.votesUp})`,
        down: sql<number>`sum(${topics.votesDown})`,
      })
      .from(topics)
      .groupBy(topics.authorId),
    db
      .select({
        userId: comments.authorId,
        up: sql<number>`sum(${comments.votesUp})`,
        down: sql<number>`sum(${comments.votesDown})`,
      })
      .from(comments)
      .groupBy(comments.authorId),
    db.select({ id: users.id }).from(users).where(eq(users.ratingOptout, true)),
    db.select({ id: users.id, username: users.username }).from(users),
  ]);

  const optoutSet = new Set(opts.map((u) => u.id));
  const names = new Map(userRows.map((u) => [u.id, u.username]));

  const topicVotes = new Map(topicStats.map((r) => [
    r.userId,
    { up: Number(r.up ?? 0), down: Number(r.down ?? 0) },
  ]));
  const commentVotes = new Map(commentStats.map((r) => [
    r.userId,
    { up: Number(r.up ?? 0), down: Number(r.down ?? 0) },
  ]));

  const contest: RatingEntry[] = [];
  const overall: RatingEntry[] = [];

  for (const u of userRows) {
    if (optoutSet.has(u.id)) continue;
    const t = topicVotes.get(u.id) ?? { up: 0, down: 0 };
    const c = commentVotes.get(u.id) ?? { up: 0, down: 0 };

    contest.push({
      userId: u.id,
      username: u.username,
      votes: t.up + t.down,
      net: t.up - t.down,
    });
    overall.push({
      userId: u.id,
      username: u.username,
      votes: t.up + t.down + c.up + c.down,
      net: t.up - t.down + c.up - c.down,
    });
  }

  const sortDesc = (a: RatingEntry[]) => a.sort((x, y) => y.net - x.net);
  sortDesc(contest);
  sortDesc(overall);

  return { contest, overall };
}

export type RatingInfo = {
  contestPlace: number | null;
  overallPlace: number | null;
  contestVotes: number;
  overallVotes: number;
  contestValue: number;
  overallValue: number;
  contestMax: number;
  overallMax: number;
  contestMaxUsername: string | null;
  overallMaxUsername: string | null;
  contestPct: number;
  overallPct: number;
};

export async function getRatingFor(userId: number, ratingOptout: boolean): Promise<RatingInfo | null> {
  if (ratingOptout) return null;
  const { contest, overall } = await getUserRatings();

  const cEntry = contest.find((e) => e.userId === userId) ?? null;
  const oEntry = overall.find((e) => e.userId === userId) ?? null;
  if (!cEntry && !oEntry) {
    return {
      contestPlace: null,
      overallPlace: null,
      contestVotes: 0,
      overallVotes: 0,
      contestValue: 0,
      overallValue: 0,
      contestMax: 0,
      overallMax: 0,
      contestMaxUsername: null,
      overallMaxUsername: null,
      contestPct: 0,
      overallPct: 0,
    };
  }

  const cPlace = contest.findIndex((e) => e.userId === userId) + 1;
  const oPlace = overall.findIndex((e) => e.userId === userId) + 1;
  const cMax = contest[0] ?? null;
  const oMax = overall[0] ?? null;
  const cValue = cEntry ? Math.max(0, cEntry.net) : 0;
  const oValue = oEntry ? Math.max(0, oEntry.net) : 0;

  const cMv = cMax ? Math.max(1, cMax.net) : 1;
  const oMv = oMax ? Math.max(1, oMax.net) : 1;

  return {
    contestPlace: cPlace || null,
    overallPlace: oPlace || null,
    contestVotes: cEntry?.votes ?? 0,
    overallVotes: oEntry?.votes ?? 0,
    contestValue: cValue,
    overallValue: oValue,
    contestMax: cMax ? Math.max(0, cMax.net) : 0,
    overallMax: oMax ? Math.max(0, oMax.net) : 0,
    contestMaxUsername: cMax?.username ?? null,
    overallMaxUsername: oMax?.username ?? null,
    contestPct: Math.min(100, Math.round((cValue / cMv) * 100)),
    overallPct: Math.min(100, Math.round((oValue / oMv) * 100)),
  };
}

export async function getTopicsByAuthor(
  username: string,
  page: number = 1,
  limit: number = 20,
): Promise<{ items: TopicListItem[]; total: number }> {
  const db = getDrizzle();
  const pageNum = Math.max(1, page);
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user) return { items: [], total: 0 };

  const [rows, totalR] = await Promise.all([
    db
      .select(topicSelect)
      .from(topics)
      .innerJoin(users, eq(users.id, topics.authorId))
      .innerJoin(categories, eq(categories.id, topics.categoryId))
      .where(eq(topics.authorId, user.id))
      .orderBy(desc(topics.createdAt))
      .limit(limit)
      .offset((pageNum - 1) * limit),
    db
      .select({ n: count(topics.id) })
      .from(topics)
      .where(eq(topics.authorId, user.id)),
  ]);

  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return { items: await hydrateAuthorHandles(items), total: totalR[0]?.n ?? 0 };
}

export async function updateUserProfile(
  username: string,
  data: {
    fullName?: string;
    country?: string;
    city?: string;
    vkUrl?: string;
    twitterUrl?: string;
    skype?: string;
    devices?: string;
  },
): Promise<boolean> {
  const db = getDrizzle();
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user) return false;
  await db
    .update(users)
    .set({
      fullName: data.fullName?.trim() || null,
      country: data.country?.trim() || null,
      city: data.city?.trim() || null,
      vkUrl: data.vkUrl?.trim() || null,
      twitterUrl: data.twitterUrl?.trim() || null,
      skype: data.skype?.trim() || null,
      devices: data.devices?.trim() || null,
    })
    .where(eq(users.id, user.id));
  void notifyProfileUpdated(user.id);
  return true;
}