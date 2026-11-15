import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { getDrizzle } from "../core/db";
import {
  messageConversations,
  messageGroupMembers,
  messageGroupMessages,
  messageImages,
  privateMessages,
  tgUsers,
  users,
} from "../core/schema";
import { publishMessageEvent } from "./realtime";
import {
  apiMessageImage,
  privateMessageImagesById,
} from "./media";
import type { ApiMessageImage, PreparedMessageImage } from "./media";

export const MESSAGE_MAX_LENGTH = 4000;
const SENDS_PER_MINUTE = 30;

export type MessageUser = {
  id: number;
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  lastSeenAt: Date | null;
  banned: boolean;
};

export type MessageListItem = {
  id: number;
  senderId: number | null;
  recipientId?: number;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  senderUsername: string;
  senderAvatarUrl: string | null;
  own: boolean;
  images: ApiMessageImage[];
};

export type ConversationListItem = {
  kind: "direct";
  id: number;
  partner: MessageUser;
  updatedAt: Date;
  unreadCount: number;
  lastMessage: {
    id: number;
    senderId: number;
    body: string;
    createdAt: Date;
    images: ApiMessageImage[];
  } | null;
};

export type MessageThread = {
  conversationId: number | null;
  partner: MessageUser;
  messages: MessageListItem[];
  hasOlder: boolean;
  olderBefore: number | null;
  readThroughId: number;
};

export type MessageUpdates = {
  partner: MessageUser;
  messages: MessageListItem[];
  readThroughId: number;
};

export type SendMessageResult =
  | {
      ok: true;
      conversationId: number;
      partner: MessageUser;
      message: MessageListItem;
    }
  | { ok: false; error: string; status: 400 | 404 | 429 };

const userSelection = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  avatarUrl: users.avatarUrl,
  lastSeenAt: users.last_seen_at,
  banned: users.banned,
};

function orderedPair(firstId: number, secondId: number): [number, number] {
  return firstId < secondId ? [firstId, secondId] : [secondId, firstId];
}

function normalizeBody(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\0/g, "").trim();
}

function messageLength(value: string): number {
  return Array.from(value).length;
}

export function prepareMessageBody(
  rawBody: string,
  allowEmpty: boolean = false,
): { ok: true; body: string } | { ok: false; error: string } {
  const body = normalizeBody(rawBody);
  if (!body && !allowEmpty) return { ok: false, error: "Напишите сообщение." };
  if (messageLength(body) > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Сообщение должно быть не длиннее ${MESSAGE_MAX_LENGTH} символов.` };
  }
  return { ok: true, body };
}

function toMessage(
  row: typeof privateMessages.$inferSelect,
  currentUserId: number,
  currentUser: Pick<MessageUser, "username" | "avatarUrl">,
  partner: Pick<MessageUser, "username" | "avatarUrl">,
  images: ApiMessageImage[] = [],
): MessageListItem {
  const own = row.senderId === currentUserId;
  const sender = own ? currentUser : partner;
  return {
    id: row.id,
    senderId: row.senderId,
    recipientId: row.recipientId,
    body: row.body,
    readAt: row.readAt,
    createdAt: row.createdAt,
    senderUsername: sender.username,
    senderAvatarUrl: sender.avatarUrl,
    own,
    images,
  };
}

async function getMessageUserById(id: number): Promise<MessageUser | null> {
  return (await getDrizzle()
    .select(userSelection)
    .from(users)
    .leftJoin(tgUsers, eq(tgUsers.userId, users.id))
    .where(and(eq(users.id, id), isNull(tgUsers.userId)))
    .get()) ?? null;
}

export async function getMessageUserByUsername(username: string): Promise<MessageUser | null> {
  const value = username.trim();
  if (!value) return null;
  return (await getDrizzle()
    .select(userSelection)
    .from(users)
    .leftJoin(tgUsers, eq(tgUsers.userId, users.id))
    .where(and(eq(users.username, value), isNull(tgUsers.userId)))
    .get()) ?? null;
}

export async function isRealMessageUser(userId: number): Promise<boolean> {
  return Boolean(await getMessageUserById(userId));
}

async function findConversation(firstId: number, secondId: number) {
  const [userLowId, userHighId] = orderedPair(firstId, secondId);
  return getDrizzle()
    .select()
    .from(messageConversations)
    .where(and(
      eq(messageConversations.userLowId, userLowId),
      eq(messageConversations.userHighId, userHighId),
    ))
    .get();
}

async function readThroughId(conversationId: number, senderId: number): Promise<number> {
  const row = await getDrizzle()
    .select({ id: sql<number | null>`max(${privateMessages.id})` })
    .from(privateMessages)
    .where(and(
      eq(privateMessages.conversationId, conversationId),
      eq(privateMessages.senderId, senderId),
      isNotNull(privateMessages.readAt),
    ))
    .get();
  return Number(row?.id ?? 0);
}

async function markConversationRead(conversationId: number, recipientId: number): Promise<boolean> {
  const updated = getDrizzle()
    .update(privateMessages)
    .set({ readAt: new Date() })
    .where(and(
      eq(privateMessages.conversationId, conversationId),
      eq(privateMessages.recipientId, recipientId),
      isNull(privateMessages.readAt),
    ))
    .returning({ id: privateMessages.id })
    .all();
  return updated.length > 0;
}

function publishReadEvent(currentUserId: number, partnerId: number): void {
  publishMessageEvent(currentUserId, { type: "read", peerId: partnerId });
  publishMessageEvent(partnerId, { type: "read", peerId: currentUserId });
}

export async function listConversations(userId: number, limit: number = 40): Promise<ConversationListItem[]> {
  const db = getDrizzle();
  const rows = await db
    .select()
    .from(messageConversations)
    .where(or(
      eq(messageConversations.userLowId, userId),
      eq(messageConversations.userHighId, userId),
    ))
    .orderBy(desc(messageConversations.updatedAt), desc(messageConversations.id))
    .limit(Math.max(1, Math.min(100, limit)));
  if (!rows.length) return [];

  const partnerIds = rows.map((row) => row.userLowId === userId ? row.userHighId : row.userLowId);
  const conversationIds = rows.map((row) => row.id);
  const [partnerRows, unreadRows] = await Promise.all([
    db.select(userSelection).from(users).where(inArray(users.id, partnerIds)),
    db
      .select({ conversationId: privateMessages.conversationId, n: count() })
      .from(privateMessages)
      .where(and(
        inArray(privateMessages.conversationId, conversationIds),
        eq(privateMessages.recipientId, userId),
        isNull(privateMessages.readAt),
      ))
      .groupBy(privateMessages.conversationId),
  ]);
  const partners = new Map(partnerRows.map((user) => [user.id, user]));
  const unread = new Map(unreadRows.map((row) => [row.conversationId, row.n]));

  const lastByConversation = new Map(rows.map((row) => [row.id, db
    .select({
      id: privateMessages.id,
      senderId: privateMessages.senderId,
      body: privateMessages.body,
      createdAt: privateMessages.createdAt,
    })
    .from(privateMessages)
    .where(eq(privateMessages.conversationId, row.id))
    .orderBy(desc(privateMessages.id))
    .limit(1)
    .get() ?? null]));
  const imageMap = await privateMessageImagesById(
    [...lastByConversation.values()].flatMap((message) => message ? [message.id] : []),
  );
  return rows.flatMap((row) => {
    const partnerId = row.userLowId === userId ? row.userHighId : row.userLowId;
    const partner = partners.get(partnerId);
    if (!partner) return [];
    const lastMessage = lastByConversation.get(row.id) ?? null;
    return [{
      kind: "direct" as const,
      id: row.id,
      partner,
      updatedAt: row.updatedAt,
      unreadCount: unread.get(row.id) ?? 0,
      lastMessage: lastMessage ? {
        ...lastMessage,
        images: imageMap.get(lastMessage.id) ?? [],
      } : null,
    }];
  });
}

export async function countUnreadMessages(userId: number): Promise<number> {
  const db = getDrizzle();
  const [direct, groups] = await Promise.all([
    db
      .select({ n: count() })
      .from(privateMessages)
      .where(and(eq(privateMessages.recipientId, userId), isNull(privateMessages.readAt)))
      .get(),
    db
      .select({ n: count() })
      .from(messageGroupMessages)
      .innerJoin(messageGroupMembers, eq(messageGroupMembers.groupId, messageGroupMessages.groupId))
      .where(and(
        eq(messageGroupMembers.userId, userId),
        gt(messageGroupMessages.id, messageGroupMembers.lastReadMessageId),
        or(isNull(messageGroupMessages.senderId), ne(messageGroupMessages.senderId, userId)),
      ))
      .get(),
  ]);
  return (direct?.n ?? 0) + (groups?.n ?? 0);
}

export async function searchMessageUsers(
  currentUserId: number,
  query: string,
  limit: number = 12,
): Promise<MessageUser[]> {
  const db = getDrizzle();
  const value = query.trim().slice(0, 32);
  const base = and(ne(users.id, currentUserId), eq(users.banned, false));
  const where = value
    ? and(
        base,
        sql`lower(${users.username}) like ${`%${value.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`,
      )
    : base;
  return db
    .select(userSelection)
    .from(users)
    .leftJoin(tgUsers, eq(tgUsers.userId, users.id))
    .where(and(where, isNull(tgUsers.userId)))
    .orderBy(desc(users.last_seen_at), users.username)
    .limit(Math.max(1, Math.min(30, limit)));
}

export async function getMessageThread(
  currentUserId: number,
  peerUsername: string,
  before?: number,
): Promise<MessageThread | null> {
  const [currentUser, partner] = await Promise.all([
    getMessageUserById(currentUserId),
    getMessageUserByUsername(peerUsername),
  ]);
  if (!currentUser || !partner || partner.id === currentUserId) return null;
  const conversation = await findConversation(currentUserId, partner.id);
  if (!conversation) {
    return {
      conversationId: null,
      partner,
      messages: [],
      hasOlder: false,
      olderBefore: null,
      readThroughId: 0,
    };
  }

  if (await markConversationRead(conversation.id, currentUserId)) {
    publishReadEvent(currentUserId, partner.id);
  }
  const pageSize = 60;
  const filter = before
    ? and(eq(privateMessages.conversationId, conversation.id), lt(privateMessages.id, before))
    : eq(privateMessages.conversationId, conversation.id);
  const rows = await getDrizzle()
    .select()
    .from(privateMessages)
    .where(filter)
    .orderBy(desc(privateMessages.id))
    .limit(pageSize + 1);
  const hasOlder = rows.length > pageSize;
  const page = rows.slice(0, pageSize).reverse();
  const imageMap = await privateMessageImagesById(page.map((row) => row.id));
  const messages = page.map((row) => toMessage(
    row,
    currentUserId,
    currentUser,
    partner,
    imageMap.get(row.id) ?? [],
  ));
  return {
    conversationId: conversation.id,
    partner,
    messages,
    hasOlder,
    olderBefore: hasOlder ? page[0]?.id ?? null : null,
    readThroughId: await readThroughId(conversation.id, currentUserId),
  };
}

export async function getMessageUpdates(
  currentUserId: number,
  peerUsername: string,
  after: number,
): Promise<MessageUpdates | null> {
  const [currentUser, partner] = await Promise.all([
    getMessageUserById(currentUserId),
    getMessageUserByUsername(peerUsername),
  ]);
  if (!currentUser || !partner || partner.id === currentUserId) return null;
  const conversation = await findConversation(currentUserId, partner.id);
  if (!conversation) return { partner, messages: [], readThroughId: 0 };
  if (await markConversationRead(conversation.id, currentUserId)) {
    publishReadEvent(currentUserId, partner.id);
  }
  const rows = await getDrizzle()
    .select()
    .from(privateMessages)
    .where(and(
      eq(privateMessages.conversationId, conversation.id),
      gt(privateMessages.id, after),
    ))
    .orderBy(privateMessages.id)
    .limit(100);
  const imageMap = await privateMessageImagesById(rows.map((row) => row.id));
  return {
    partner,
    messages: rows.map((row) => toMessage(
      row,
      currentUserId,
      currentUser,
      partner,
      imageMap.get(row.id) ?? [],
    )),
    readThroughId: await readThroughId(conversation.id, currentUserId),
  };
}

export async function sendPrivateMessage(
  senderId: number,
  peerUsername: string,
  rawBody: string,
  images: PreparedMessageImage[] = [],
): Promise<SendMessageResult> {
  const prepared = prepareMessageBody(rawBody, images.length > 0);
  if (!prepared.ok) return { ok: false, error: prepared.error, status: 400 };
  const body = prepared.body;

  const [sender, partner] = await Promise.all([
    getMessageUserById(senderId),
    getMessageUserByUsername(peerUsername),
  ]);
  if (!sender) return { ok: false, error: "Отправитель не найден. Войдите снова.", status: 400 };
  if (!partner) return { ok: false, error: "Пользователь не найден.", status: 404 };
  if (partner.id === senderId) return { ok: false, error: "Нельзя написать самому себе.", status: 400 };
  if (partner.banned) return { ok: false, error: "Этому пользователю сейчас нельзя написать.", status: 400 };

  const db = getDrizzle();
  const since = new Date(Date.now() - 60_000);
  const [recentDirect, recentGroup] = await Promise.all([
    db
      .select({ n: count() })
      .from(privateMessages)
      .where(and(eq(privateMessages.senderId, senderId), gt(privateMessages.createdAt, since)))
      .get(),
    db
      .select({ n: count() })
      .from(messageGroupMessages)
      .where(and(eq(messageGroupMessages.senderId, senderId), gt(messageGroupMessages.createdAt, since)))
      .get(),
  ]);
  if ((recentDirect?.n ?? 0) + (recentGroup?.n ?? 0) >= SENDS_PER_MINUTE) {
    return { ok: false, error: "Слишком много сообщений за минуту. Подождите немного.", status: 429 };
  }

  const [userLowId, userHighId] = orderedPair(senderId, partner.id);
  const now = new Date();
  const inserted = db.transaction((tx) => {
    let conversation = tx
      .select()
      .from(messageConversations)
      .where(and(
        eq(messageConversations.userLowId, userLowId),
        eq(messageConversations.userHighId, userHighId),
      ))
      .get();
    if (!conversation) {
      conversation = tx
        .insert(messageConversations)
        .values({ userLowId, userHighId, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .returning()
        .get();
      conversation ??= tx
        .select()
        .from(messageConversations)
        .where(and(
          eq(messageConversations.userLowId, userLowId),
          eq(messageConversations.userHighId, userHighId),
        ))
        .get();
    }
    if (!conversation) throw new Error("Не удалось создать диалог");
    const message = tx
      .insert(privateMessages)
      .values({
        conversationId: conversation.id,
        senderId,
        recipientId: partner.id,
        body,
        createdAt: now,
      })
      .returning()
      .get();
    if (!message) throw new Error("Не удалось сохранить сообщение");
    const imageRows = images.map((image, position) => {
      const row = tx.insert(messageImages).values({
        privateMessageId: message.id,
        position,
        ...image,
        createdAt: now,
      }).returning().get();
      if (!row) throw new Error("Не удалось сохранить изображение сообщения");
      return row;
    });
    tx.update(messageConversations)
      .set({ updatedAt: now })
      .where(eq(messageConversations.id, conversation.id))
      .run();
    return { conversationId: conversation.id, message, images: imageRows };
  });

  publishMessageEvent(senderId, {
    type: "message",
    peerId: partner.id,
    messageId: inserted.message.id,
  });
  publishMessageEvent(partner.id, {
    type: "message",
    peerId: senderId,
    messageId: inserted.message.id,
  });

  return {
    ok: true,
    conversationId: inserted.conversationId,
    partner,
    message: toMessage(
      inserted.message,
      senderId,
      sender,
      partner,
      inserted.images.map(apiMessageImage),
    ),
  };
}
