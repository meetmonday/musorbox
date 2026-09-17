import { getDrizzle } from "../core/db";
import { users, topics, comments, categories, firms, sessions } from "../core/schema";
import { and, eq, sql, desc, count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { notifyProfileUpdated } from "../activitypub/notify";
import type { TopicListItem } from "../topics/service";
import { mapTopicRow, attachTags, topicSelect } from "../topics/service";
import { changePassword } from "../auth/service";

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
      .where(and(eq(topics.authorId, row.id), eq(topics.hidden, false)))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(distinct ${comments.topicId})` })
      .from(comments)
      .innerJoin(topics, eq(topics.id, comments.topicId))
      .where(and(eq(comments.authorId, row.id), eq(comments.hidden, false), eq(topics.hidden, false)))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count(comments.id) })
      .from(comments)
      .where(and(eq(comments.authorId, row.id), eq(comments.hidden, false)))
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
  return getUserByUsername(username);
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
      .where(and(eq(topics.authorId, user.id), eq(topics.hidden, false)))
      .orderBy(desc(topics.createdAt))
      .limit(limit)
      .offset((pageNum - 1) * limit),
    db
      .select({ n: count(topics.id) })
      .from(topics)
      .where(and(eq(topics.authorId, user.id), eq(topics.hidden, false))),
  ]);

  const items = rows.map(mapTopicRow);
  await attachTags(items);
  return { items, total: totalR[0]?.n ?? 0 };
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

export async function listFirms(): Promise<{ id: number; name: string }[]> {
  const db = getDrizzle();
  return db.select({ id: firms.id, name: firms.name }).from(firms).orderBy(firms.name);
}

export async function getSettingsState(userId: number): Promise<SettingsState | null> {
  const db = getDrizzle();
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) return null;
  return {
    ratingOptout: row.ratingOptout,
    deviceFirmId: await getDeviceFirmId(row.id),
    avatarUrl: row.avatarUrl,
  };
}

async function getDeviceFirmId(userId: number): Promise<number | null> {
  const db = getDrizzle();
  const token = await db.query.users.findFirst({ where: eq(users.id, userId) });
  void token;
  return null;
}

export type SettingsState = {
  ratingOptout: boolean;
  deviceFirmId: number | null;
  avatarUrl: string | null;
};

export type SaveSettingsResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

export async function saveSettings(
  userId: number,
  data: { ratingOptout: boolean; deviceFirmId: number | null },
): Promise<SaveSettingsResult> {
  const db = getDrizzle();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return { ok: false, error: "Пользователь не найден." };
  if (data.deviceFirmId !== null) {
    const firm = await db.query.firms.findFirst({ where: eq(firms.id, data.deviceFirmId) });
    if (!firm) return { ok: false, error: "Указан неизвестный производитель устройства.", field: "device_firm" };
  }
  await db
    .update(users)
    .set({ ratingOptout: data.ratingOptout, devices: null })
    .where(eq(users.id, userId));
  return { ok: true };
}

export async function saveAvatar(userId: number, filename: string): Promise<void> {
  const db = getDrizzle();
  await db.update(users).set({ avatarUrl: `/avatars/${filename}` }).where(eq(users.id, userId));
}

export async function deleteSessionsFor(userId: number): Promise<number> {
  const db = getDrizzle();
  const deleted = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ token: sessions.token });
  return deleted.length;
}

export async function changePasswordAndDropSessions(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<SaveSettingsResult> {
  const result = await changePassword(userId, currentPassword, newPassword);
  if (!result.ok) return { ok: false, error: result.error, field: "current_password" };
  return { ok: true };
}