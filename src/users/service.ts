import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { getDrizzle } from "../core/db";
import { users, topics, comments, categories } from "../core/schema";
import { and, eq, sql, desc, count } from "drizzle-orm";
import { notifyProfileUpdated } from "../activitypub/notify";
import type { TopicListItem } from "../topics/service";
import { mapTopicRow, attachTags, topicSelect } from "../topics/service";

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

export type ProfileInput = {
  fullName: string;
  country: string;
  city: string;
  vkUrl: string;
  twitterUrl: string;
  skype: string;
  devices: string;
  avatarUrl: string;
  ratingOptout: boolean;
};

export type SaveSettingsResult =
  | { ok: true }
  | { ok: false; error: string; field?: string };

async function removeAvatar(avatarUrl: string | null) {
  if (!avatarUrl || !/^\/avatars\/\d+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_avatar\.webp$/.test(avatarUrl)) return;
  try {
    const reference = await getDrizzle().query.users.findFirst({
      where: sql`${users.avatarUrl} LIKE ${`%${avatarUrl}%`}`,
      columns: { id: true },
    });
    if (reference) return;
  } catch (error) {
    console.error("Не удалось проверить старый аватар:", error);
    return;
  }
  try {
    await unlink(`public${avatarUrl}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Не удалось удалить старый аватар:", error);
  }
}

export async function updateUserProfile(
  username: string,
  data: ProfileInput,
  avatar?: File,
): Promise<SaveSettingsResult> {
  const limits = { fullName: 100, country: 100, city: 100, vkUrl: 500, twitterUrl: 500, skype: 100, devices: 1000, avatarUrl: 2000 };
  for (const [field, limit] of Object.entries(limits)) {
    if (field === "avatarUrl" && avatar) continue;
    if (data[field as keyof typeof limits].trim().length > limit) {
      return { ok: false, error: `Значение поля слишком длинное (не более ${limit} символов).`, field };
    }
  }
  let avatarUrl = avatar ? "" : data.avatarUrl.trim();
  if (avatarUrl && !/^\/(?!\/)/.test(avatarUrl)) {
    try {
      const url = new URL(avatarUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      return { ok: false, error: "Укажите адрес аватара по HTTP или HTTPS либо путь на сайте.", field: "avatarUrl" };
    }
  }
  const db = getDrizzle();
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user) return { ok: false, error: "Пользователь не найден." };
  if (avatar) {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(avatar.type) || avatar.size > 8 * 1024 * 1024) {
      return { ok: false, error: "Недопустимый формат аватара (jpg/png/gif/webp, до 8 МБ)." };
    }
    let image: Buffer;
    try {
      image = await sharp(Buffer.from(await avatar.arrayBuffer()), { animated: false })
        .rotate()
        .resize(128, 128, { fit: "cover", position: "centre" })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      return { ok: false, error: "Не удалось прочитать изображение. Выберите исправный файл JPG, PNG, GIF или WebP." };
    }
    avatarUrl = `/avatars/${Date.now()}_${crypto.randomUUID()}_avatar.webp`;
    try {
      mkdirSync("public/avatars", { recursive: true });
      await Bun.write(`public${avatarUrl}`, image);
    } catch {
      await removeAvatar(avatarUrl);
      return { ok: false, error: "Не удалось сохранить аватар. Попробуйте ещё раз." };
    }
  }
  try {
    await db
      .update(users)
      .set({
        fullName: data.fullName.trim() || null,
        country: data.country.trim() || null,
        city: data.city.trim() || null,
        vkUrl: data.vkUrl.trim() || null,
        twitterUrl: data.twitterUrl.trim() || null,
        skype: data.skype.trim() || null,
        devices: data.devices.trim() || null,
        avatarUrl: avatarUrl || null,
        ratingOptout: data.ratingOptout,
      })
      .where(eq(users.id, user.id));
  } catch (error) {
    if (avatar) await removeAvatar(avatarUrl);
    throw error;
  }
  if (user.avatarUrl !== avatarUrl) await removeAvatar(user.avatarUrl);
  void notifyProfileUpdated(user.id);
  return { ok: true };
}


