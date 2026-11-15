import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { config } from "../core/config";
import type { UserContext } from "../core/middleware";
import { requireAuth } from "../core/middleware";
import { renderPage } from "../layout/layout";
import {
  GroupCreatePage,
  GroupJoinPage,
  MessageItemView,
  MessengerHead,
  MessengerPage,
} from "./components";
import {
  countUnreadMessages,
  getMessageUserByUsername,
  getMessageThread,
  getMessageUpdates,
  listConversations,
  searchMessageUsers,
  sendPrivateMessage,
} from "./service";
import type { MessageThread } from "./service";
import { canOpenMessageStream, subscribeToMessageEvents } from "./realtime";
import type { MessageRealtimeEvent } from "./realtime";
import {
  addGroupMember,
  createGroupChat,
  deleteGroup,
  getGroupInvite,
  getGroupThread,
  getGroupUpdates,
  isGroupMember,
  joinGroupByInvite,
  leaveGroup,
  listGroupConversations,
  removeGroupMember,
  resetGroupInvite,
  sendGroupMessage,
} from "./group-service";
import type { GroupThread } from "./group-service";
import { openMessageImage } from "./media";

type AppContext = Context<{ Variables: UserContext }>;

const app = new Hono<{ Variables: UserContext }>({ strict: false });
app.use("/messages", requireAuth);
app.use("/messages/*", requireAuth);

function isAjax(c: AppContext): boolean {
  return c.req.header("x-requested-with") === "XMLHttpRequest";
}

function streamEvents(c: AppContext, accepts: (event: MessageRealtimeEvent) => boolean) {
  const user = c.get("user")!;
  if (!canOpenMessageStream(user.id)) return c.text("Слишком много открытых соединений.", 429);
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    const queue: Array<{ type: "message" | "read"; messageId?: number }> = [];
    let wake: (() => void) | null = null;
    const unsubscribe = subscribeToMessageEvents(user.id, (event) => {
      if (!accepts(event)) return;
      if (queue.length < 100) queue.push({ type: event.type, messageId: event.messageId });
      const resume = wake;
      wake = null;
      resume?.();
    });
    stream.onAbort(() => {
      unsubscribe();
      const resume = wake;
      wake = null;
      resume?.();
    });
    await stream.writeSSE({ event: "ready", data: "{}", retry: 2000 });
    try {
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timeout);
              if (wake === finish) wake = null;
              resolve();
            };
            const timeout = setTimeout(finish, 15_000);
            wake = finish;
          });
        }
        if (stream.aborted) break;
        const event = queue.shift();
        if (event) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
            id: String(event.messageId ?? Date.now()),
          });
        } else {
          await stream.writeSSE({ event: "ping", data: String(Date.now()) });
        }
      }
    } finally {
      unsubscribe();
    }
  });
}

async function renderMessenger(
  c: AppContext,
  options: {
    thread?: MessageThread | null;
    groupThread?: GroupThread | null;
    query?: string;
    error?: string;
    managementError?: string;
    draft?: string;
    history?: boolean;
    status?: 400 | 403 | 404 | 429;
  } = {},
) {
  const user = c.get("user")!;
  const query = (options.query ?? "").trim().slice(0, 32);
  const [directConversations, groupConversations, unreadMessagesCount] = await Promise.all([
    listConversations(user.id),
    listGroupConversations(user.id),
    countUnreadMessages(user.id),
  ]);
  const conversations = [...directConversations, ...groupConversations]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 80);
  const searchResults = options.thread || options.groupThread
    ? []
    : await searchMessageUsers(user.id, query, query ? 20 : 8);
  const html = await renderPage({
    title: `Личные сообщения — ${config.siteName}`,
    description: "Личные сообщения пользователей сайта",
    user: { ...user, unreadMessagesCount },
    head: <MessengerHead />,
    children: (
      <MessengerPage
        currentUser={{ ...user, unreadMessagesCount }}
        conversations={conversations}
        thread={options.thread}
        groupThread={options.groupThread}
        searchQuery={query}
        searchResults={searchResults}
        error={options.error}
        managementError={options.managementError}
        draft={options.draft}
        history={options.history}
      />
    ),
  });
  if (options.status) c.status(options.status);
  return c.html(`<!DOCTYPE html>${html}`);
}

function positiveId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function beforeMessage(c: AppContext): number | undefined {
  const value = c.req.query("before");
  if (value === undefined) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

async function renderGroupCreate(
  c: AppContext,
  options: { error?: string; title?: string; participants?: string; status?: 400 } = {},
) {
  const user = c.get("user")!;
  const html = await renderPage({
    title: `Новый групповой чат — ${config.siteName}`,
    user,
    head: <MessengerHead />,
    children: <GroupCreatePage error={options.error} title={options.title} participants={options.participants} />,
  });
  if (options.status) c.status(options.status);
  return c.html(`<!DOCTYPE html>${html}`);
}

async function renderGroupInvitePage(
  c: AppContext,
  token: string,
  options: { error?: string; status?: 400 | 404 } = {},
) {
  const user = c.get("user")!;
  const invite = options.error ? null : await getGroupInvite(token, user.id);
  const html = await renderPage({
    title: `Приглашение в групповой чат — ${config.siteName}`,
    user,
    head: <MessengerHead />,
    children: <GroupJoinPage token={token} invite={invite} error={options.error ?? (!invite ? "Ссылка-приглашение недействительна или была заменена." : undefined)} />,
  });
  if (options.status || !invite) c.status(options.status ?? 404);
  return c.html(`<!DOCTYPE html>${html}`);
}

async function renderGroupManagementError(
  c: AppContext,
  groupId: number,
  error: string,
  status: 400 | 403 | 404,
) {
  const groupThread = await getGroupThread(c.get("user")!.id, groupId);
  if (!groupThread) return c.text(error, status);
  return renderMessenger(c, { groupThread, managementError: error, status });
}

app.get("/messages", async (c) => {
  const query = String(c.req.query("q") ?? "");
  return renderMessenger(c, { query });
});

app.get("/messages/media/:id", async (c) => {
  const imageId = positiveId(c.req.param("id"));
  const size = c.req.query("size");
  if (!imageId || (size !== undefined && size !== "thumb")) return c.notFound();
  const media = await openMessageImage(imageId, c.get("user")!.id, size === "thumb");
  if (!media) return c.notFound();
  c.header("Content-Type", media.mimeType);
  c.header("Content-Length", String(media.file.size));
  c.header("Content-Disposition", "inline");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "private, no-store");
  return c.body(media.file.stream());
});

app.get("/messages/groups/new", (c) => renderGroupCreate(c));

app.post("/messages/groups/new", async (c) => {
  const body = await c.req.parseBody();
  const title = typeof body.title === "string" ? body.title : "";
  const participants = typeof body.participants === "string" ? body.participants : "";
  const usernames = participants.split(/[\s,;]+/).filter(Boolean);
  const result = await createGroupChat(c.get("user")!.id, title, usernames);
  if (!result.ok) {
    return renderGroupCreate(c, { error: result.error, title, participants, status: result.status });
  }
  return c.redirect(`/messages/groups/${result.groupId}`, 303);
});

app.get("/messages/groups/join/:token", async (c) => {
  const token = c.req.param("token");
  const invite = await getGroupInvite(token, c.get("user")!.id);
  if (!invite) return renderGroupInvitePage(c, token, { status: 404 });
  if (invite.alreadyMember) return c.redirect(`/messages/groups/${invite.groupId}`);
  return renderGroupInvitePage(c, token);
});

app.post("/messages/groups/join/:token", async (c) => {
  const token = c.req.param("token");
  const result = await joinGroupByInvite(c.get("user")!.id, token);
  if (!result.ok || !result.groupId) {
    return renderGroupInvitePage(c, token, {
      error: result.ok ? "Не удалось присоединиться к группе." : result.error,
      status: result.ok ? 400 : result.status === 404 ? 404 : 400,
    });
  }
  return c.redirect(`/messages/groups/${result.groupId}`, 303);
});

app.get("/messages/groups/:id/updates", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  const after = Number(c.req.query("after") ?? 0);
  if (!groupId || !Number.isSafeInteger(after) || after < 0) {
    return c.json({ ok: false, error: "Неверный номер группы или сообщения." }, 400);
  }
  const messages = await getGroupUpdates(c.get("user")!.id, groupId, after);
  if (!messages) return c.json({ ok: false, error: "Групповой чат не найден." }, 404);
  const lastId = messages.at(-1)?.id ?? after;
  c.header("Cache-Control", "no-store");
  return c.json({
    ok: true,
    html: messages.map((message) => String(<MessageItemView message={message} />)).join(""),
    lastId,
    readThroughId: 0,
  });
});

app.get("/messages/groups/:id/events", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  const user = c.get("user")!;
  if (!groupId || !await isGroupMember(user.id, groupId)) return c.text("Групповой чат не найден.", 404);
  return streamEvents(c, (event) => event.groupId === groupId);
});

app.get("/messages/groups/:id", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.notFound();
  const before = beforeMessage(c);
  const groupThread = await getGroupThread(c.get("user")!.id, groupId, before);
  if (!groupThread) return c.text("Групповой чат не найден или вы больше не участник.", 404);
  return renderMessenger(c, { groupThread, history: before !== undefined });
});

app.post("/messages/groups/:id", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const body = await c.req.parseBody();
  const messageBody = typeof body.body === "string" ? body.body : "";
  const result = await sendGroupMessage(c.get("user")!.id, groupId, messageBody);
  if (!result.ok) {
    if (isAjax(c)) return c.json({ ok: false, error: result.error }, result.status);
    const groupThread = await getGroupThread(c.get("user")!.id, groupId);
    if (!groupThread) return c.text(result.error, result.status);
    return renderMessenger(c, { groupThread, error: result.error, draft: messageBody, status: result.status });
  }
  if (isAjax(c)) {
    return c.json({
      ok: true,
      html: String(<MessageItemView message={result.message} />),
      lastId: result.message.id,
    });
  }
  return c.redirect(`/messages/groups/${groupId}#message_${result.message.id}`, 303);
});

app.post("/messages/groups/:id/members/add", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const body = await c.req.parseBody();
  const username = typeof body.username === "string" ? body.username : "";
  const result = await addGroupMember(c.get("user")!.id, groupId, username);
  if (!result.ok) return renderGroupManagementError(c, groupId, result.error, result.status);
  return c.redirect(`/messages/groups/${groupId}`, 303);
});

app.post("/messages/groups/:id/members/remove", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const body = await c.req.parseBody();
  const targetUserId = typeof body.user_id === "string" ? positiveId(body.user_id) : null;
  if (!targetUserId) return renderGroupManagementError(c, groupId, "Неверный участник.", 400);
  const result = await removeGroupMember(c.get("user")!.id, groupId, targetUserId);
  if (!result.ok) return renderGroupManagementError(c, groupId, result.error, result.status);
  return c.redirect(`/messages/groups/${groupId}`, 303);
});

app.post("/messages/groups/:id/invite/reset", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const result = await resetGroupInvite(c.get("user")!.id, groupId);
  if (!result.ok) return renderGroupManagementError(c, groupId, result.error, result.status);
  return c.redirect(`/messages/groups/${groupId}`, 303);
});

app.post("/messages/groups/:id/leave", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const result = await leaveGroup(c.get("user")!.id, groupId);
  if (!result.ok) return renderGroupManagementError(c, groupId, result.error, result.status);
  return c.redirect("/messages", 303);
});

app.post("/messages/groups/:id/delete", async (c) => {
  const groupId = positiveId(c.req.param("id"));
  if (!groupId) return c.text("Неверный номер группы.", 400);
  const result = await deleteGroup(c.get("user")!.id, groupId);
  if (!result.ok) return renderGroupManagementError(c, groupId, result.error, result.status);
  return c.redirect("/messages", 303);
});

app.get("/messages/:username/updates", async (c) => {
  const after = Number(c.req.query("after") ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) {
    return c.json({ ok: false, error: "Неверный номер сообщения." }, 400);
  }
  const result = await getMessageUpdates(c.get("user")!.id, c.req.param("username"), after);
  if (!result) return c.json({ ok: false, error: "Собеседник не найден." }, 404);
  const lastId = result.messages.at(-1)?.id ?? after;
  c.header("Cache-Control", "no-store");
  return c.json({
    ok: true,
    html: result.messages.map((message) => String(<MessageItemView message={message} />)).join(""),
    lastId,
    readThroughId: result.readThroughId,
  });
});

app.get("/messages/:username/events", async (c) => {
  const user = c.get("user")!;
  const partner = await getMessageUserByUsername(c.req.param("username"));
  if (!partner || partner.id === user.id) return c.text("Собеседник не найден.", 404);
  return streamEvents(c, (event) => event.peerId === partner.id);
});

app.get("/messages/:username", async (c) => {
  const user = c.get("user")!;
  const username = c.req.param("username");
  if (username === user.username) return c.redirect("/messages");
  const beforeValue = c.req.query("before");
  const parsedBefore = beforeValue === undefined ? undefined : Number(beforeValue);
  const before = parsedBefore !== undefined && Number.isSafeInteger(parsedBefore) && parsedBefore > 0
    ? parsedBefore
    : undefined;
  const thread = await getMessageThread(user.id, username, before);
  if (!thread) return renderMessenger(c, { query: username, status: 404 });
  return renderMessenger(c, { thread, history: before !== undefined });
});

app.post("/messages/:username", async (c) => {
  const user = c.get("user")!;
  const username = c.req.param("username");
  const body = await c.req.parseBody();
  const messageBody = typeof body.body === "string" ? body.body : "";
  const result = await sendPrivateMessage(user.id, username, messageBody);
  if (!result.ok) {
    if (isAjax(c)) return c.json({ ok: false, error: result.error }, result.status);
    const thread = await getMessageThread(user.id, username);
    if (!thread) return renderMessenger(c, { query: username, status: result.status });
    return renderMessenger(c, {
      thread,
      error: result.error,
      draft: messageBody,
      status: result.status,
    });
  }

  if (isAjax(c)) {
    return c.json({
      ok: true,
      html: String(<MessageItemView message={result.message} />),
      lastId: result.message.id,
    });
  }
  return c.redirect(`/messages/${encodeURIComponent(result.partner.username)}#message_${result.message.id}`, 303);
});

export default app;
