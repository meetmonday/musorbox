import { randomBytes } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDrizzle } from "../core/db";
import {
  messageGroupMembers,
  messageGroupMessages,
  messageGroups,
  messageBots,
  messageImages,
  privateMessages,
  tgUsers,
  users,
} from "../core/schema";
import { publishMessageEvent } from "./realtime";
import { isRealMessageUser, prepareMessageBody } from "./service";
import type { MessageListItem } from "./service";
import {
  apiMessageImage,
  cleanupMessageImages,
  groupMessageImagesById,
} from "./media";
import type { ApiMessageImage, PreparedMessageImage } from "./media";
import { deliverGroupMessageToBots } from "../bot-api/delivery";

const MAX_GROUP_MEMBERS = 50;
const SENDS_PER_MINUTE = 30;

export type GroupMember = {
  id: number;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: "owner" | "member";
  joinedAt: Date;
};

export type GroupConversationListItem = {
  kind: "group";
  id: number;
  title: string;
  updatedAt: Date;
  unreadCount: number;
  memberCount: number;
  lastMessage: {
    id: number;
    senderId: number | null;
    senderName: string;
    senderAvatarUrl: string | null;
    body: string;
    createdAt: Date;
    images: ApiMessageImage[];
  } | null;
};

export type GroupThread = {
  group: {
    id: number;
    title: string;
    ownerId: number;
    createdAt: Date;
    inviteToken: string;
  };
  members: GroupMember[];
  messages: MessageListItem[];
  currentUserRole: "owner" | "member";
  hasOlder: boolean;
  olderBefore: number | null;
};

type GroupActionResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 403 | 404 };

export type CreateGroupResult =
  | { ok: true; groupId: number }
  | { ok: false; error: string; status: 400 };

export type SendGroupMessageResult =
  | { ok: true; message: MessageListItem }
  | { ok: false; error: string; status: 400 | 403 | 404 | 429 };

export type GroupInviteInfo = {
  groupId: number;
  title: string;
  memberCount: number;
  alreadyMember: boolean;
};

const groupMessageSelection = {
  id: messageGroupMessages.id,
  groupId: messageGroupMessages.groupId,
  senderId: messageGroupMessages.senderId,
  body: messageGroupMessages.body,
  createdAt: messageGroupMessages.createdAt,
  senderUsername: users.username,
  senderAvatarUrl: users.avatarUrl,
};

function toMessage(
  row: {
    id: number;
    senderId: number | null;
    body: string;
    createdAt: Date;
    senderUsername: string | null;
    senderAvatarUrl: string | null;
  },
  currentUserId: number,
  images: ApiMessageImage[] = [],
): MessageListItem {
  return {
    id: row.id,
    senderId: row.senderId,
    body: row.body,
    readAt: null,
    createdAt: row.createdAt,
    senderUsername: row.senderUsername ?? "Удалённый пользователь",
    senderAvatarUrl: row.senderAvatarUrl,
    own: row.senderId === currentUserId,
    images,
  };
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validTitle(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 2 && length <= 80;
}

function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

async function groupForMember(userId: number, groupId: number) {
  return getDrizzle()
    .select({
      id: messageGroups.id,
      title: messageGroups.title,
      inviteToken: messageGroups.inviteToken,
      ownerId: messageGroups.ownerId,
      createdAt: messageGroups.createdAt,
      updatedAt: messageGroups.updatedAt,
      role: messageGroupMembers.role,
      lastReadMessageId: messageGroupMembers.lastReadMessageId,
    })
    .from(messageGroupMembers)
    .innerJoin(messageGroups, eq(messageGroups.id, messageGroupMembers.groupId))
    .where(and(eq(messageGroupMembers.groupId, groupId), eq(messageGroupMembers.userId, userId)))
    .get();
}

export async function isGroupMember(userId: number, groupId: number): Promise<boolean> {
  return Boolean(await groupForMember(userId, groupId));
}

async function listMembers(groupId: number): Promise<GroupMember[]> {
  return getDrizzle()
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      role: messageGroupMembers.role,
      joinedAt: messageGroupMembers.joinedAt,
    })
    .from(messageGroupMembers)
    .innerJoin(users, eq(users.id, messageGroupMembers.userId))
    .where(eq(messageGroupMembers.groupId, groupId))
    .orderBy(sql`case when ${messageGroupMembers.role} = 'owner' then 0 else 1 end`, users.username);
}

async function markGroupRead(userId: number, groupId: number): Promise<void> {
  const latest = await getDrizzle()
    .select({ id: sql<number | null>`max(${messageGroupMessages.id})` })
    .from(messageGroupMessages)
    .where(eq(messageGroupMessages.groupId, groupId))
    .get();
  const lastReadMessageId = Number(latest?.id ?? 0);
  await getDrizzle()
    .update(messageGroupMembers)
    .set({ lastReadMessageId })
    .where(and(
      eq(messageGroupMembers.groupId, groupId),
      eq(messageGroupMembers.userId, userId),
      lt(messageGroupMembers.lastReadMessageId, lastReadMessageId),
    ));
}

export async function listGroupConversations(
  userId: number,
  limit: number = 40,
): Promise<GroupConversationListItem[]> {
  const db = getDrizzle();
  const rows = await db
    .select({
      id: messageGroups.id,
      title: messageGroups.title,
      updatedAt: messageGroups.updatedAt,
      lastReadMessageId: messageGroupMembers.lastReadMessageId,
    })
    .from(messageGroupMembers)
    .innerJoin(messageGroups, eq(messageGroups.id, messageGroupMembers.groupId))
    .where(eq(messageGroupMembers.userId, userId))
    .orderBy(desc(messageGroups.updatedAt), desc(messageGroups.id))
    .limit(Math.max(1, Math.min(100, limit)));

  const lastByGroup = new Map(rows.map((row) => [row.id, db
      .select(groupMessageSelection)
      .from(messageGroupMessages)
      .leftJoin(users, eq(users.id, messageGroupMessages.senderId))
      .where(eq(messageGroupMessages.groupId, row.id))
      .orderBy(desc(messageGroupMessages.id))
      .limit(1)
      .get() ?? null]));
  const imageMap = await groupMessageImagesById(
    [...lastByGroup.values()].flatMap((message) => message ? [message.id] : []),
  );
  return rows.map((row) => {
    const lastMessage = lastByGroup.get(row.id) ?? null;
    const unread = db
      .select({ n: count() })
      .from(messageGroupMessages)
      .where(and(
        eq(messageGroupMessages.groupId, row.id),
        gt(messageGroupMessages.id, row.lastReadMessageId),
        or(isNull(messageGroupMessages.senderId), ne(messageGroupMessages.senderId, userId)),
      ))
      .get();
    const members = db
      .select({ n: count() })
      .from(messageGroupMembers)
      .where(eq(messageGroupMembers.groupId, row.id))
      .get();
    return {
      kind: "group" as const,
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
      unreadCount: unread?.n ?? 0,
      memberCount: members?.n ?? 0,
      lastMessage: lastMessage ? {
        id: lastMessage.id,
        senderId: lastMessage.senderId,
        senderName: lastMessage.senderUsername ?? "Удалённый пользователь",
        senderAvatarUrl: lastMessage.senderAvatarUrl,
        body: lastMessage.body,
        createdAt: lastMessage.createdAt,
        images: imageMap.get(lastMessage.id) ?? [],
      } : null,
    };
  });
}

export async function getGroupThread(
  userId: number,
  groupId: number,
  before?: number,
): Promise<GroupThread | null> {
  const membership = await groupForMember(userId, groupId);
  if (!membership) return null;
  let inviteToken = membership.inviteToken;
  if (!inviteToken) {
    const generated = newInviteToken();
    const updated = await getDrizzle().update(messageGroups)
      .set({ inviteToken: generated })
      .where(and(eq(messageGroups.id, groupId), isNull(messageGroups.inviteToken)))
      .returning({ inviteToken: messageGroups.inviteToken });
    inviteToken = updated[0]?.inviteToken ?? (await getDrizzle()
      .select({ inviteToken: messageGroups.inviteToken })
      .from(messageGroups)
      .where(eq(messageGroups.id, groupId))
      .get())?.inviteToken ?? generated;
  }
  await markGroupRead(userId, groupId);

  const pageSize = 60;
  const filter = before
    ? and(eq(messageGroupMessages.groupId, groupId), lt(messageGroupMessages.id, before))
    : eq(messageGroupMessages.groupId, groupId);
  const rows = await getDrizzle()
    .select(groupMessageSelection)
    .from(messageGroupMessages)
    .leftJoin(users, eq(users.id, messageGroupMessages.senderId))
    .where(filter)
    .orderBy(desc(messageGroupMessages.id))
    .limit(pageSize + 1);
  const hasOlder = rows.length > pageSize;
  const page = rows.slice(0, pageSize).reverse();
  const imageMap = await groupMessageImagesById(page.map((row) => row.id));
  return {
    group: {
      id: membership.id,
      title: membership.title,
      ownerId: membership.ownerId,
      createdAt: membership.createdAt,
      inviteToken,
    },
    members: await listMembers(groupId),
    messages: page.map((row) => toMessage(row, userId, imageMap.get(row.id) ?? [])),
    currentUserRole: membership.role,
    hasOlder,
    olderBefore: hasOlder ? page[0]?.id ?? null : null,
  };
}

export async function getGroupUpdates(
  userId: number,
  groupId: number,
  after: number,
): Promise<MessageListItem[] | null> {
  if (!await groupForMember(userId, groupId)) return null;
  await markGroupRead(userId, groupId);
  const rows = await getDrizzle()
    .select(groupMessageSelection)
    .from(messageGroupMessages)
    .leftJoin(users, eq(users.id, messageGroupMessages.senderId))
    .where(and(eq(messageGroupMessages.groupId, groupId), gt(messageGroupMessages.id, after)))
    .orderBy(messageGroupMessages.id)
    .limit(100);
  const imageMap = await groupMessageImagesById(rows.map((row) => row.id));
  return rows.map((row) => toMessage(row, userId, imageMap.get(row.id) ?? []));
}

export async function createGroupChat(
  ownerId: number,
  rawTitle: string,
  rawUsernames: string[],
): Promise<CreateGroupResult> {
  const title = normalizeTitle(rawTitle);
  if (!validTitle(title)) {
    return { ok: false, error: "Название группы должно содержать от 2 до 80 символов.", status: 400 };
  }
  const db = getDrizzle();
  if (!await isRealMessageUser(ownerId)) {
    return { ok: false, error: "Групповые чаты доступны только пользователям сайта.", status: 400 };
  }
  const owner = await db.select({ username: users.username }).from(users).where(eq(users.id, ownerId)).get();
  if (!owner) return { ok: false, error: "Владелец группы не найден.", status: 400 };
  const usernames = [...new Set(rawUsernames.map((name) => name.trim()).filter(Boolean))]
    .filter((name) => name !== owner.username);
  if (usernames.length >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: `В группе может быть не более ${MAX_GROUP_MEMBERS} участников.`, status: 400 };
  }
  const invited = usernames.length ? await db
    .select({ id: users.id, username: users.username, banned: users.banned })
    .from(users)
    .leftJoin(tgUsers, eq(tgUsers.userId, users.id))
    .leftJoin(messageBots, eq(messageBots.userId, users.id))
    .where(and(
      inArray(users.username, usernames),
      isNull(tgUsers.userId),
      or(isNull(messageBots.userId), isNull(messageBots.disabledAt)),
    )) : [];
  const byName = new Map(invited.map((user) => [user.username, user]));
  const unavailable = usernames.filter((name) => !byName.get(name) || byName.get(name)!.banned);
  if (unavailable.length) {
    return {
      ok: false,
      error: `Не удалось добавить: ${unavailable.join(", ")}. Проверьте логины пользователей.`,
      status: 400,
    };
  }

  const now = new Date();
  const groupId = db.transaction((tx) => {
    const group = tx
      .insert(messageGroups)
      .values({ title, inviteToken: newInviteToken(), ownerId, createdAt: now, updatedAt: now })
      .returning({ id: messageGroups.id })
      .get();
    if (!group) throw new Error("Не удалось создать групповой чат");
    tx.insert(messageGroupMembers).values([
      { groupId: group.id, userId: ownerId, role: "owner", joinedAt: now },
      ...invited.map((user) => ({
        groupId: group.id,
        userId: user.id,
        role: "member" as const,
        joinedAt: now,
      })),
    ]).run();
    return group.id;
  });
  return { ok: true, groupId };
}

export async function sendGroupMessage(
  senderId: number,
  groupId: number,
  rawBody: string,
  images: PreparedMessageImage[] = [],
): Promise<SendGroupMessageResult> {
  const prepared = prepareMessageBody(rawBody, images.length > 0);
  if (!prepared.ok) return { ok: false, error: prepared.error, status: 400 };
  if (!await isRealMessageUser(senderId)) {
    return { ok: false, error: "Групповые чаты доступны только пользователям сайта.", status: 403 };
  }
  const membership = await groupForMember(senderId, groupId);
  if (!membership) return { ok: false, error: "Групповой чат не найден или вы больше не участник.", status: 404 };

  const db = getDrizzle();
  const since = new Date(Date.now() - 60_000);
  const [recentDirect, recentGroup] = await Promise.all([
    db.select({ n: count() }).from(privateMessages)
      .where(and(eq(privateMessages.senderId, senderId), gt(privateMessages.createdAt, since))).get(),
    db.select({ n: count() }).from(messageGroupMessages)
      .where(and(eq(messageGroupMessages.senderId, senderId), gt(messageGroupMessages.createdAt, since))).get(),
  ]);
  if ((recentDirect?.n ?? 0) + (recentGroup?.n ?? 0) >= SENDS_PER_MINUTE) {
    return { ok: false, error: "Слишком много сообщений за минуту. Подождите немного.", status: 429 };
  }

  const sender = await db
    .select({ username: users.username, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, senderId))
    .get();
  if (!sender) return { ok: false, error: "Отправитель не найден. Войдите снова.", status: 400 };
  const now = new Date();
  const inserted = db.transaction((tx) => {
    const message = tx
      .insert(messageGroupMessages)
      .values({ groupId, senderId, body: prepared.body, createdAt: now })
      .returning()
      .get();
    if (!message) throw new Error("Не удалось сохранить сообщение группы");
    const imageRows = images.map((image, position) => {
      const row = tx.insert(messageImages).values({
        groupMessageId: message.id,
        position,
        ...image,
        createdAt: now,
      }).returning().get();
      if (!row) throw new Error("Не удалось сохранить изображение сообщения группы");
      return row;
    });
    tx.update(messageGroups).set({ updatedAt: now }).where(eq(messageGroups.id, groupId)).run();
    return { message, images: imageRows };
  });
  const memberRows = await db
    .select({ userId: messageGroupMembers.userId })
    .from(messageGroupMembers)
    .where(eq(messageGroupMembers.groupId, groupId));
  for (const member of memberRows) {
    publishMessageEvent(member.userId, {
      type: "message",
      groupId,
      messageId: inserted.message.id,
    });
  }
  try {
    deliverGroupMessageToBots(groupId, { ...inserted.message, senderId });
  } catch (error) {
    console.error(`[bot-api] Не удалось поставить сообщение группы ${inserted.message.id} в очередь:`, error);
  }
  return {
    ok: true,
    message: toMessage({
      ...inserted.message,
      senderUsername: sender.username,
      senderAvatarUrl: sender.avatarUrl,
    }, senderId, inserted.images.map(apiMessageImage)),
  };
}

export async function addGroupMember(ownerId: number, groupId: number, username: string): Promise<GroupActionResult> {
  const db = getDrizzle();
  const group = await db.select().from(messageGroups).where(eq(messageGroups.id, groupId)).get();
  if (!group) return { ok: false, error: "Групповой чат не найден.", status: 404 };
  if (group.ownerId !== ownerId) return { ok: false, error: "Добавлять участников может только владелец группы.", status: 403 };
  const target = await db.select({ id: users.id, banned: users.banned }).from(users)
    .leftJoin(tgUsers, eq(tgUsers.userId, users.id))
    .leftJoin(messageBots, eq(messageBots.userId, users.id))
    .where(and(
      eq(users.username, username.trim()),
      isNull(tgUsers.userId),
      or(isNull(messageBots.userId), isNull(messageBots.disabledAt)),
    )).get();
  if (!target || target.banned) return { ok: false, error: "Пользователь не найден или недоступен.", status: 400 };
  const memberCount = await db.select({ n: count() }).from(messageGroupMembers)
    .where(eq(messageGroupMembers.groupId, groupId)).get();
  if ((memberCount?.n ?? 0) >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: `В группе уже ${MAX_GROUP_MEMBERS} участников.`, status: 400 };
  }
  const existing = await db.select({ userId: messageGroupMembers.userId }).from(messageGroupMembers)
    .where(and(eq(messageGroupMembers.groupId, groupId), eq(messageGroupMembers.userId, target.id))).get();
  if (existing) return { ok: false, error: "Этот пользователь уже состоит в группе.", status: 400 };
  const latest = await db.select({ id: sql<number | null>`max(${messageGroupMessages.id})` })
    .from(messageGroupMessages).where(eq(messageGroupMessages.groupId, groupId)).get();
  await db.insert(messageGroupMembers).values({
    groupId,
    userId: target.id,
    lastReadMessageId: Number(latest?.id ?? 0),
  });
  return { ok: true };
}

export async function removeGroupMember(
  ownerId: number,
  groupId: number,
  targetUserId: number,
): Promise<GroupActionResult> {
  const db = getDrizzle();
  const group = await db.select().from(messageGroups).where(eq(messageGroups.id, groupId)).get();
  if (!group) return { ok: false, error: "Групповой чат не найден.", status: 404 };
  if (group.ownerId !== ownerId) return { ok: false, error: "Удалять участников может только владелец группы.", status: 403 };
  if (targetUserId === ownerId) return { ok: false, error: "Владелец не может удалить себя из группы.", status: 400 };
  const removed = await db.delete(messageGroupMembers)
    .where(and(eq(messageGroupMembers.groupId, groupId), eq(messageGroupMembers.userId, targetUserId)))
    .returning({ userId: messageGroupMembers.userId });
  if (!removed.length) return { ok: false, error: "Участник не найден.", status: 404 };
  return { ok: true };
}

export async function leaveGroup(userId: number, groupId: number): Promise<GroupActionResult> {
  const membership = await groupForMember(userId, groupId);
  if (!membership) return { ok: false, error: "Вы не состоите в этой группе.", status: 404 };
  if (membership.ownerId === userId) {
    return { ok: false, error: "Владелец не может покинуть группу. Можно удалить групповой чат.", status: 400 };
  }
  await getDrizzle().delete(messageGroupMembers)
    .where(and(eq(messageGroupMembers.groupId, groupId), eq(messageGroupMembers.userId, userId)));
  return { ok: true };
}

export async function deleteGroup(ownerId: number, groupId: number): Promise<GroupActionResult> {
  const db = getDrizzle();
  const storedImages = await db
    .select({ storageKey: messageImages.storageKey, thumbnailKey: messageImages.thumbnailKey })
    .from(messageImages)
    .innerJoin(messageGroupMessages, eq(messageGroupMessages.id, messageImages.groupMessageId))
    .where(eq(messageGroupMessages.groupId, groupId));
  const deleted = await db.delete(messageGroups)
    .where(and(eq(messageGroups.id, groupId), eq(messageGroups.ownerId, ownerId)))
    .returning({ id: messageGroups.id });
  if (!deleted.length) return { ok: false, error: "Группа не найдена или у вас нет прав на её удаление.", status: 403 };
  cleanupMessageImages(storedImages);
  return { ok: true };
}

export async function getGroupInvite(token: string, userId: number): Promise<GroupInviteInfo | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const db = getDrizzle();
  const group = await db.select({ id: messageGroups.id, title: messageGroups.title })
    .from(messageGroups).where(eq(messageGroups.inviteToken, token)).get();
  if (!group) return null;
  const [members, ownMembership] = await Promise.all([
    db.select({ n: count() }).from(messageGroupMembers)
      .where(eq(messageGroupMembers.groupId, group.id)).get(),
    db.select({ userId: messageGroupMembers.userId }).from(messageGroupMembers)
      .where(and(eq(messageGroupMembers.groupId, group.id), eq(messageGroupMembers.userId, userId))).get(),
  ]);
  return {
    groupId: group.id,
    title: group.title,
    memberCount: members?.n ?? 0,
    alreadyMember: Boolean(ownMembership),
  };
}

export async function joinGroupByInvite(userId: number, token: string): Promise<GroupActionResult & { groupId?: number }> {
  if (!await isRealMessageUser(userId)) {
    return { ok: false, error: "Вступать в группы могут только пользователи сайта.", status: 403 };
  }
  const invite = await getGroupInvite(token, userId);
  if (!invite) return { ok: false, error: "Ссылка-приглашение недействительна или была заменена.", status: 404 };
  if (invite.alreadyMember) return { ok: true, groupId: invite.groupId };
  if (invite.memberCount >= MAX_GROUP_MEMBERS) {
    return { ok: false, error: "В групповом чате больше нет свободных мест.", status: 400 };
  }
  const db = getDrizzle();
  const latest = await db.select({ id: sql<number | null>`max(${messageGroupMessages.id})` })
    .from(messageGroupMessages).where(eq(messageGroupMessages.groupId, invite.groupId)).get();
  await db.insert(messageGroupMembers).values({
    groupId: invite.groupId,
    userId,
    lastReadMessageId: Number(latest?.id ?? 0),
  }).onConflictDoNothing();
  return { ok: true, groupId: invite.groupId };
}

export async function resetGroupInvite(ownerId: number, groupId: number): Promise<GroupActionResult> {
  const updated = await getDrizzle().update(messageGroups)
    .set({ inviteToken: newInviteToken() })
    .where(and(eq(messageGroups.id, groupId), eq(messageGroups.ownerId, ownerId)))
    .returning({ id: messageGroups.id });
  if (!updated.length) return { ok: false, error: "Заменить ссылку может только владелец группы.", status: 403 };
  return { ok: true };
}
