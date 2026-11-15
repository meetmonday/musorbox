import type { FC } from "hono/jsx";
import { formatDateDots, pluralize } from "../core/utils";
import { config } from "../core/config";
import { avatarSrc } from "../topics/components";
import type {
  ConversationListItem,
  MessageListItem,
  MessageThread,
  MessageUser,
} from "./service";
import { MESSAGE_MAX_LENGTH } from "./service";
import type { GroupConversationListItem, GroupInviteInfo, GroupThread } from "./group-service";

const messengerStyles = `
  #messages_app { margin:0 0 35px; min-height:520px; font-size:1.2em; color:#171717; }
  #messages_app * { box-sizing:border-box; }
  #messages_app .messages-heading { margin-right:0; }
  #messages_app .messages-heading small { display:inline-block; margin-left:10px; color:#999; font-size:11px; vertical-align:middle; }
  #messages_app .messages-shell { display:table; width:100%; table-layout:fixed; border-top:5px solid #f1f1f1; border-bottom:5px solid #f1f1f1; }
  #messages_app .messages-nav,
  #messages_app .messages-main { display:table-cell; vertical-align:top; }
  #messages_app .messages-nav { width:310px; border-right:5px solid #f1f1f1; background:#f8f8f8; }
  #messages_app .messages-nav-title { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #ddd; background:#fff; color:#777; font-size:14px; }
  #messages_app .messages-new-group { padding:2px 5px; font-size:10px; font-weight:normal; }
  #messages_app .messages-search { padding:10px; border-bottom:1px solid #ddd; background:#f1f1f1; }
  #messages_app .messages-search-row { display:flex; width:100%; }
  #messages_app .messages-search-input,
  #messages_app .messages-search-button { display:table-cell; vertical-align:middle; }
  #messages_app .messages-search-input { flex:1 1 auto; min-width:0; width:auto; border:1px solid #c0c0c0; padding:6px 7px; font:12px Verdana,sans-serif; background:#fff; }
  #messages_app .messages-search-button { flex:0 0 auto; width:auto; border:0; padding:7px 10px; background:#1fb6f2; color:#fff; font:12px Verdana,sans-serif; cursor:pointer; }
  #messages_app .messages-search-button:hover { background:#171717; }
  #messages_app .messages-conversations { max-height:610px; overflow-y:auto; }
  #messages_app a.messages-conversation { position:relative; display:block; min-height:64px; padding:9px 36px 9px 64px; border-bottom:1px solid #ddd; border-left:5px solid transparent; color:#171717; background:#fff; text-decoration:none; }
  #messages_app a.messages-conversation:hover { color:#171717; background:#f1f1f1; }
  #messages_app a.messages-conversation--unread { border-left-color:#1fb6f2; background:#eef3ff; font-weight:bold; }
  #messages_app a.messages-conversation--active { border-left-color:#1fb6f2; background:#dff5fd; color:#171717; }
  #messages_app a.messages-conversation--active:hover { border-left-color:#1fb6f2; background:#cdeefa; color:#171717; }
  #messages_app .messages-conversation-avatar { position:absolute; left:10px; top:10px; width:40px; height:40px; object-fit:cover; border:3px solid #f1f1f1; }
  #messages_app .messages-group-avatar { position:absolute; left:10px; top:10px; width:40px; height:40px; border:3px solid #f1f1f1; background:#c0c0c0; color:#fff; font:22px/34px Arial,sans-serif; text-align:center; text-transform:uppercase; }
  #messages_app .messages-conversation--active .messages-group-avatar { border-color:#fff; background:#1fb6f2; }
  #messages_app .messages-conversation-name { display:block; padding-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  #messages_app .messages-conversation-preview { display:block; overflow:hidden; color:#777; font-size:10px; font-weight:normal; text-overflow:ellipsis; white-space:nowrap; }
  #messages_app .messages-conversation--active .messages-conversation-preview { color:#55717c; }
  #messages_app .messages-conversation--active .messages-conversation-avatar { border-color:#fff; }
  #messages_app .messages-conversation-time { display:block; padding-top:3px; color:#999; font:9px Arial,sans-serif; font-weight:normal; }
  #messages_app .messages-unread { position:absolute; right:9px; top:22px; min-width:20px; padding:2px 4px; background:#ee0000; color:#fff; font:bold 10px Arial,sans-serif; text-align:center; }
  #messages_app .messages-empty-nav { padding:20px 12px; color:#777; line-height:1.6; }
  #messages_app .messages-main { background:#fff; }
  #messages_app .messages-thread-head { position:relative; min-height:70px; padding:10px 12px 10px 72px; border-bottom:1px solid #ddd; background:#f1f1f1; }
  #messages_app .messages-thread-avatar { position:absolute; left:12px; top:10px; width:48px; height:48px; border:5px solid #fff; object-fit:cover; }
  #messages_app .messages-thread-group-avatar { position:absolute; left:12px; top:10px; width:48px; height:48px; border:5px solid #fff; background:#1fb6f2; color:#fff; font:26px/38px Arial,sans-serif; text-align:center; text-transform:uppercase; }
  #messages_app .messages-thread-name { display:inline-block; margin-top:3px; color:#171717; font-size:18px; }
  #messages_app a.messages-thread-name:hover { color:#fff; }
  #messages_app .messages-thread-login { padding-top:3px; color:#777; font-size:10px; }
  #messages_app .messages-thread-back { display:none; position:absolute; right:12px; top:13px; padding:5px 8px; background:#fff; }
  #messages_app .messages-history-nav { padding:7px 12px; border-bottom:1px solid #ddd; background:#ffffdd; text-align:center; font-size:10px; }
  #messages_app .messages-group-members { border-bottom:1px solid #ddd; background:#fafafa; }
  #messages_app .messages-group-members summary { padding:7px 12px; color:#777; cursor:pointer; }
  #messages_app .messages-group-members-body { padding:0 12px 10px; }
  #messages_app .messages-group-member { display:inline-flex; align-items:center; margin:3px 8px 3px 0; padding:3px 5px; background:#f1f1f1; vertical-align:middle; }
  #messages_app .messages-group-member img { width:20px; height:20px; margin-right:5px; object-fit:cover; }
  #messages_app .messages-group-owner { color:#999; font-size:9px; }
  #messages_app .messages-group-remove { display:inline; margin-left:4px; }
  #messages_app .messages-group-remove button { border:0; padding:0 3px; background:none; color:#ee0000; cursor:pointer; }
  #messages_app .messages-group-manage { margin-top:8px; padding-top:8px; border-top:1px solid #ddd; }
  #messages_app .messages-group-manage input { border:1px solid #c0c0c0; padding:4px 6px; font:11px Verdana,sans-serif; }
  #messages_app .messages-group-invite { margin-top:8px; padding-top:8px; border-top:1px solid #ddd; }
  #messages_app .messages-group-invite input { box-sizing:border-box; width:360px; max-width:100%; border:1px solid #c0c0c0; padding:4px 6px; color:#555; font:10px Verdana,sans-serif; }
  #messages_app .messages-small-button { border:0; padding:5px 9px; background:#1fb6f2; color:#fff; font:10px Verdana,sans-serif; cursor:pointer; }
  #messages_app .messages-danger-button { border:0; padding:4px 8px; background:#c0c0c0; color:#171717; font:10px Verdana,sans-serif; cursor:pointer; }
  #messages_app .messages-manage-error { padding:6px 0; color:#ee0000; font-weight:bold; }
  #messages_app .messages-log { min-height:310px; max-height:610px; padding:12px; overflow-y:auto; background:#fff; }
  #messages_app .messages-log-empty { margin:65px auto; max-width:330px; color:#777; line-height:1.7; text-align:center; }
  #messages_app .messages-message { position:relative; margin:0 14% 10px 0; padding:8px 10px 9px; border-left:5px solid #c0c0c0; background:#f1f1f1; overflow-wrap:anywhere; }
  #messages_app .messages-message--own { margin-right:0; margin-left:14%; border-left-color:#1fb6f2; background:#eef9fe; }
  #messages_app .messages-message-head { min-height:20px; padding-bottom:5px; color:#777; font-size:10px; }
  #messages_app .messages-message-head a { font-weight:bold; }
  #messages_app .messages-message-avatar { width:20px; height:20px; margin:-2px 6px 0 0; object-fit:cover; vertical-align:middle; }
  #messages_app .messages-message-time { float:right; padding-left:8px; color:#999; font:9px Arial,sans-serif; }
  #messages_app .messages-message-images { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:3px; max-width:520px; margin:2px 0 7px; padding:3px; background:#fff; border:1px solid #d4d4d4; }
  #messages_app .messages-message-images--single { display:block; }
  #messages_app .messages-message-images--odd > a:last-child { grid-column:1 / -1; }
  #messages_app .messages-message-image { display:block; min-width:0; background:#ddd; line-height:0; overflow:hidden; }
  #messages_app .messages-message-image:hover { outline:3px solid #1fb6f2; outline-offset:-3px; }
  #messages_app .messages-message-image img { display:block; width:100%; height:160px; object-fit:cover; }
  #messages_app .messages-message-images--single img { height:auto; max-height:460px; object-fit:contain; }
  #messages_app .messages-message-body { white-space:pre-wrap; line-height:1.55; font-size:12px; }
  #messages_app .messages-message-state { padding-top:5px; color:#999; font:9px Arial,sans-serif; text-align:right; }
  #messages_app .messages-message-state--read { color:#1b93c2; }
  #messages_app .messages-compose { padding:12px; border-top:5px solid #f1f1f1; background:#fff; }
  #messages_app .messages-compose textarea { display:block; width:100%; min-height:90px; resize:vertical; border:1px solid #c0c0c0; padding:8px; font:12px/1.5 Verdana,sans-serif; }
  #messages_app .messages-compose textarea:focus,
  #messages_app .messages-search-input:focus { border-color:#1fb6f2; outline:2px solid #b9e9fb; }
  #messages_app .messages-compose-bottom { min-height:31px; padding-top:7px; }
  #messages_app .messages-send { float:right; border:0; padding:7px 16px; background:#1fb6f2; color:#fff; font:12px Verdana,sans-serif; cursor:pointer; }
  #messages_app .messages-send:hover { background:#171717; }
  #messages_app .messages-send:disabled { background:#999; cursor:wait; }
  #messages_app .messages-compose-hint { color:#999; font-size:9px; }
  #messages_app .messages-compose-error { padding-bottom:7px; color:#ee0000; font-weight:bold; }
  #messages_app .messages-start { padding:28px; }
  #messages_app .messages-start-title { margin-bottom:8px; font-size:22px; }
  #messages_app .messages-start-copy { max-width:520px; margin:0 0 20px; color:#777; line-height:1.6; }
  #messages_app .messages-people { border-top:5px solid #f1f1f1; }
  #messages_app a.messages-person { position:relative; display:block; min-height:60px; padding:10px 12px 10px 64px; border-bottom:1px solid #ddd; color:#171717; background:#fff; }
  #messages_app a.messages-person:hover { color:#fff; background:#1fb6f2; }
  #messages_app .messages-person img { position:absolute; left:10px; top:8px; width:42px; height:42px; object-fit:cover; border:3px solid #f1f1f1; }
  #messages_app .messages-person-name { display:block; font-size:14px; }
  #messages_app .messages-person-detail { display:block; padding-top:3px; color:#999; font-size:10px; }
  #messages_app a.messages-person:hover .messages-person-detail { color:#fff; }
  #messages_app .messages-account-closed { padding:12px; border-top:5px solid #f1f1f1; color:#777; background:#ffffdd; }
  #messages_app .messages-group-create { max-width:650px; padding:20px; border:5px solid #f1f1f1; background:#fff; }
  #messages_app .messages-group-create label { display:block; margin:0 0 5px; font-weight:bold; }
  #messages_app .messages-group-create input,
  #messages_app .messages-group-create textarea { box-sizing:border-box; width:100%; margin-bottom:14px; border:1px solid #c0c0c0; padding:7px; font:12px/1.5 Verdana,sans-serif; }
  #messages_app .messages-group-create textarea { min-height:90px; resize:vertical; }
  #messages_app .messages-group-create-help { margin:-8px 0 14px; color:#777; font-size:10px; }
  #messages_app .messages-group-create-error { margin-bottom:12px; padding:8px 10px; border-left:5px solid #ee0000; background:#ffeeee; color:#990000; }
  #messages_app .messages-mobile-back { display:none; }
  #messages_app a:focus-visible,
  #messages_app button:focus-visible,
  #messages_app input:focus-visible,
  #messages_app textarea:focus-visible { outline:2px solid #1fb6f2; outline-offset:2px; }
  @media (max-width:760px) {
    #messages_app .messages-shell,
    #messages_app .messages-nav,
    #messages_app .messages-main { display:block; width:100%; }
    #messages_app .messages-nav { border-right:0; border-bottom:5px solid #f1f1f1; }
    #messages_app.messages-has-thread .messages-nav { display:none; }
    #messages_app .messages-mobile-back { display:inline; }
    #messages_app .messages-log { max-height:none; }
    #messages_app .messages-message,
    #messages_app .messages-message--own { margin-left:0; margin-right:0; }
    #messages_app .messages-thread-head { padding-right:90px; }
    #messages_app .messages-thread-back { display:block; right:8px; }
    #messages_app .messages-message-image img { height:120px; }
    #messages_app .messages-message-images--single img { height:auto; max-height:70vh; }
  }
  @media (prefers-reduced-motion:reduce) {
    #messages_app * { scroll-behavior:auto !important; }
  }
`;

const messengerScript = `
(function () {
  function initMessenger() {
    var root = document.getElementById("messages_app");
    if (!root) return;
    var log = document.getElementById("messages_log");
    if (!log) return;

    function nearBottom() {
      return log.scrollHeight - log.scrollTop - log.clientHeight < 90;
    }
    function scrollBottom() {
      log.scrollTop = log.scrollHeight;
    }
    function applyReadThrough(value) {
      var through = parseInt(value || "0", 10) || 0;
      var own = log.querySelectorAll(".messages-message--own[data-message-id]");
      for (var i = 0; i < own.length; i++) {
        var id = parseInt(own[i].getAttribute("data-message-id") || "0", 10);
        if (id <= through) {
          var state = own[i].querySelector(".messages-message-state");
          if (state) {
            state.textContent = "Прочитано";
            state.classList.add("messages-message-state--read");
          }
        }
      }
    }
    function appendHtml(html, forceScroll) {
      if (!html) return;
      var shouldScroll = forceScroll || nearBottom();
      var empty = log.querySelector(".messages-log-empty");
      if (empty) empty.parentNode.removeChild(empty);
      var temp = document.createElement("div");
      temp.innerHTML = html;
      while (temp.firstElementChild) {
        var node = temp.firstElementChild;
        var id = node.getAttribute("data-message-id");
        if (!id || !document.getElementById("message_" + id)) log.appendChild(node);
        else temp.removeChild(node);
      }
      if (shouldScroll) scrollBottom();
    }

    if (root.getAttribute("data-history") !== "1") window.setTimeout(scrollBottom, 0);
    applyReadThrough(root.getAttribute("data-read-through"));

    var form = document.getElementById("messages_compose");
    if (form) {
      var textarea = form.querySelector("textarea[name=body]");
      var button = form.querySelector("button[type=submit]");
      var error = form.querySelector(".messages-compose-error");
      var counter = form.querySelector(".messages-compose-count");
      function updateCount() {
        if (counter && textarea) counter.textContent = String(Array.from(textarea.value).length);
      }
      if (textarea) {
        textarea.addEventListener("input", updateCount);
        textarea.addEventListener("keydown", function (event) {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (form.requestSubmit) form.requestSubmit();
            else if (button) button.click();
          }
        });
        updateCount();
      }
      form.addEventListener("submit", function (event) {
        if (!window.fetch || !textarea) return;
        event.preventDefault();
        if (!textarea.value.trim()) {
          if (error) error.textContent = "Напишите сообщение.";
          textarea.focus();
          return;
        }
        if (error) error.textContent = "";
        if (button) button.disabled = true;
        var sentText = textarea.value;
        fetch(form.action, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: "body=" + encodeURIComponent(textarea.value)
        }).then(function (response) {
          if (response.status === 401) {
            window.location.href = "/login";
            throw new Error("auth");
          }
          return response.json();
        }).then(function (data) {
          if (!data.ok) {
            if (error) error.textContent = data.error || "Не удалось отправить сообщение.";
            return;
          }
          if (!root.getAttribute("data-conversation-id")) {
            window.location.href = form.action + "#message_" + data.lastId;
            return;
          }
          appendHtml(data.html, true);
          root.setAttribute("data-last-id", String(data.lastId));
          var active = root.querySelector(".messages-conversation--active");
          if (active) {
            var preview = active.querySelector(".messages-conversation-preview");
            var oneLine = sentText.replace(/\\s+/g, " ").trim();
            if (oneLine.length > 62) oneLine = oneLine.slice(0, 61) + "…";
            if (preview) preview.textContent = "Вы: " + oneLine;
            var time = active.querySelector(".messages-conversation-time");
            var now = new Date();
            if (time) time.textContent = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
            if (active.parentNode) active.parentNode.insertBefore(active, active.parentNode.firstChild);
          }
          textarea.value = "";
          updateCount();
          textarea.focus();
        }).catch(function () {
          if (error) error.textContent = "Не удалось отправить сообщение. Проверьте соединение.";
        }).then(function () {
          if (button) button.disabled = false;
        });
      });
    }

    var updatesUrl = root.getAttribute("data-updates-url");
    var eventsUrl = root.getAttribute("data-events-url");
    var polling = false;
    function poll() {
      if (!updatesUrl || polling || document.hidden || !window.fetch) return;
      polling = true;
      var after = parseInt(root.getAttribute("data-last-id") || "0", 10) || 0;
      fetch(updatesUrl + "?after=" + after, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" }
      }).then(function (response) {
        if (response.status === 401) {
          window.location.href = "/login";
          throw new Error("auth");
        }
        return response.json();
      }).then(function (data) {
        if (!data.ok) return;
        appendHtml(data.html, false);
        if (data.lastId > after) root.setAttribute("data-last-id", String(data.lastId));
        applyReadThrough(data.readThroughId);
      }).catch(function () {}).then(function () {
        polling = false;
      });
    }
    if (updatesUrl) {
      var realtimeOpen = false;
      if (eventsUrl && window.EventSource) {
        var events = new EventSource(eventsUrl);
        events.onopen = function () {
          realtimeOpen = true;
          poll();
        };
        events.addEventListener("message", poll);
        events.addEventListener("read", poll);
        events.addEventListener("ready", poll);
        events.onerror = function () {
          realtimeOpen = false;
        };
        window.addEventListener("beforeunload", function () { events.close(); });
      }
      window.setInterval(function () {
        if (!realtimeOpen) poll();
      }, 8000);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) poll();
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMessenger);
  else initMessenger();
})();
`;

export const MessengerHead: FC = () => (
  <>
    <style dangerouslySetInnerHTML={{ __html: messengerStyles }} />
    <script dangerouslySetInnerHTML={{ __html: messengerScript }} />
  </>
);

function displayName(user: MessageUser): string {
  return user.fullName || user.username;
}

function previewText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 62 ? `${text.slice(0, 61)}…` : text;
}

function shortDate(date: Date): string {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getFullYear()).slice(-2)}`;
}

const ConversationLink: FC<{
  item: ConversationListItem | GroupConversationListItem;
  currentUserId: number;
  activeUsername?: string;
  activeGroupId?: number;
}> = ({ item, currentUserId, activeUsername, activeGroupId }) => {
  const isGroup = item.kind === "group";
  const active = isGroup ? activeGroupId === item.id : activeUsername === item.partner.username;
  const classes = [
    "messages-conversation",
    item.unreadCount ? "messages-conversation--unread" : "",
    active ? "messages-conversation--active" : "",
  ].filter(Boolean).join(" ");
  const href = isGroup ? `/messages/groups/${item.id}` : `/messages/${encodeURIComponent(item.partner.username)}`;
  const lastMessage = item.lastMessage;
  const prefix = lastMessage
    ? lastMessage.senderId === currentUserId
      ? "Вы: "
      : item.kind === "group" ? `${item.lastMessage?.senderName ?? "Пользователь"}: ` : ""
    : "";
  return (
    <a class={classes} href={href}>
      {isGroup ? (
        <span class="messages-group-avatar" aria-hidden="true">{item.title.charAt(0)}</span>
      ) : (
        <img class="messages-conversation-avatar" src={avatarSrc(item.partner.avatarUrl)} alt="" />
      )}
      <span class="messages-conversation-name">
        {isGroup ? item.title : displayName(item.partner)}
      </span>
      <span class="messages-conversation-preview">
        {prefix}
        {lastMessage
          ? previewText(lastMessage.body) || (lastMessage.images.length === 1 ? "Фотография" : `${lastMessage.images.length} фото`)
          : isGroup ? `${item.memberCount} участников` : "Диалог начат"}
      </span>
      <span class="messages-conversation-time">{shortDate(lastMessage?.createdAt ?? item.updatedAt)}</span>
      {item.unreadCount ? (
        <span class="messages-unread" aria-label={`${item.unreadCount} непрочитанных`}>
          {item.unreadCount > 99 ? "99+" : item.unreadCount}
        </span>
      ) : null}
    </a>
  );
};

export const MessageItemView: FC<{ message: MessageListItem }> = ({ message }) => (
  <article
    id={`message_${message.id}`}
    class={`messages-message${message.own ? " messages-message--own" : ""}`}
    data-message-id={message.id}
  >
    <div class="messages-message-head">
      <img class="messages-message-avatar" src={avatarSrc(message.senderAvatarUrl)} alt="" />
      {message.senderId ? (
        <a href={`/users/${encodeURIComponent(message.senderUsername)}`}>{message.own ? "Вы" : message.senderUsername}</a>
      ) : (
        <span>{message.senderUsername}</span>
      )}
      <time class="messages-message-time" datetime={message.createdAt.toISOString()}>
        {formatDateDots(message.createdAt)}
      </time>
    </div>
    {message.images.length ? (
      <div
        class={[
          "messages-message-images",
          message.images.length === 1 ? "messages-message-images--single" : "",
          message.images.length > 1 && message.images.length % 2 === 1 ? "messages-message-images--odd" : "",
        ].filter(Boolean).join(" ")}
        aria-label={message.images.length === 1 ? "Фотография" : `Альбом: ${message.images.length} фото`}
      >
        {message.images.map((image, index) => (
          <a
            key={image.id}
            class="messages-message-image"
            href={`/messages/media/${image.id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть изображение ${index + 1} из ${message.images.length}`}
          >
            <img
              src={`/messages/media/${image.id}?size=thumb`}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
              alt=""
            />
          </a>
        ))}
      </div>
    ) : null}
    {message.body ? <div class="messages-message-body">{message.body}</div> : null}
    {message.own ? (
      <div class={`messages-message-state${message.readAt ? " messages-message-state--read" : ""}`}>
        {message.readAt ? "Прочитано" : "Отправлено"}
      </div>
    ) : null}
  </article>
);

const ThreadView: FC<{
  thread: MessageThread;
  error?: string;
  draft?: string;
  history: boolean;
}> = ({ thread, error, draft, history }) => {
  const partner = thread.partner;
  const path = `/messages/${encodeURIComponent(partner.username)}`;
  return (
    <section aria-label={`Переписка с ${partner.username}`}>
      <header class="messages-thread-head">
        <img class="messages-thread-avatar" src={avatarSrc(partner.avatarUrl)} alt="" />
        <a class="messages-thread-name" href={`/users/${encodeURIComponent(partner.username)}`}>
          {displayName(partner)}
        </a>
        <div class="messages-thread-login">@{partner.username}</div>
        <a class="messages-thread-back" href="/messages">
          <span class="messages-mobile-back">← </span>Все диалоги
        </a>
      </header>
      {thread.hasOlder && thread.olderBefore ? (
        <div class="messages-history-nav">
          <a href={`${path}?before=${thread.olderBefore}`}>Показать более ранние сообщения</a>
        </div>
      ) : history ? (
        <div class="messages-history-nav">Это начало переписки.</div>
      ) : null}
      {history ? (
        <div class="messages-history-nav">
          <a href={path}>Вернуться к новым сообщениям →</a>
        </div>
      ) : null}
      <div id="messages_log" class="messages-log" role="log" aria-live="polite" aria-relevant="additions">
        {thread.messages.length ? thread.messages.map((message) => (
          <MessageItemView key={message.id} message={message} />
        )) : (
          <div class="messages-log-empty">
            Здесь пока пусто. Напишите первое сообщение — диалог появится в списке слева.
          </div>
        )}
      </div>
      {!history && !partner.banned ? (
        <form id="messages_compose" class="messages-compose" method="post" action={path}>
          <div class="messages-compose-error" role="alert">{error ?? ""}</div>
          <label for="message_body" style="display:block;padding-bottom:5px;font-weight:bold">
            Сообщение для {partner.username}
          </label>
          <textarea
            id="message_body"
            name="body"
            maxlength={MESSAGE_MAX_LENGTH}
            placeholder="Напишите сообщение…"
            required
          >{draft ?? ""}</textarea>
          <div class="messages-compose-bottom">
            <button class="messages-send" type="submit">Отправить</button>
            <span class="messages-compose-hint">
              <span class="messages-compose-count">{Array.from(draft ?? "").length}</span>/{MESSAGE_MAX_LENGTH}; Ctrl+Enter — отправить
            </span>
          </div>
        </form>
      ) : partner.banned ? (
        <div class="messages-account-closed">Учётная запись собеседника заблокирована. Старую переписку можно читать, но новые сообщения не отправляются.</div>
      ) : null}
    </section>
  );
};

const GroupThreadView: FC<{
  thread: GroupThread;
  currentUserId: number;
  error?: string;
  managementError?: string;
  draft?: string;
  history: boolean;
}> = ({ thread, currentUserId, error, managementError, draft, history }) => {
  const group = thread.group;
  const path = `/messages/groups/${group.id}`;
  const inviteUrl = new URL(`/messages/groups/join/${group.inviteToken}`, config.baseUrl).toString();
  const isOwner = thread.currentUserRole === "owner";
  const membersText = `${thread.members.length} ${pluralize(thread.members.length, "участник", "участника", "участников")}`;
  return (
    <section aria-label={`Групповой чат ${group.title}`}>
      <header class="messages-thread-head">
        <span class="messages-thread-group-avatar" aria-hidden="true">{group.title.charAt(0)}</span>
        <span class="messages-thread-name">{group.title}</span>
        <div class="messages-thread-login">{membersText} · групповой чат</div>
        <a class="messages-thread-back" href="/messages">
          <span class="messages-mobile-back">← </span>Все диалоги
        </a>
      </header>
      <details class="messages-group-members" open={Boolean(managementError)}>
        <summary>Участники ({thread.members.length})</summary>
        <div class="messages-group-members-body">
          <div>
            {thread.members.map((member) => (
              <span class="messages-group-member" key={member.id}>
                <img src={avatarSrc(member.avatarUrl)} alt="" />
                <a href={`/users/${encodeURIComponent(member.username)}`}>{member.username}</a>
                {member.role === "owner" ? <span class="messages-group-owner"> · владелец</span> : null}
                {isOwner && member.id !== currentUserId ? (
                  <form class="messages-group-remove" method="post" action={`${path}/members/remove`}>
                    <input type="hidden" name="user_id" value={member.id} />
                    <button type="submit" title={`Удалить ${member.username} из группы`} aria-label={`Удалить ${member.username} из группы`}>×</button>
                  </form>
                ) : null}
              </span>
            ))}
          </div>
          {managementError ? <div class="messages-manage-error" role="alert">{managementError}</div> : null}
          <div class="messages-group-invite">
            <label for="group_invite_link" style="margin-right:5px">Ссылка для вступления:</label>
            <input id="group_invite_link" type="text" value={inviteUrl} readonly onclick="this.select()" />
            {isOwner ? (
              <form method="post" action={`${path}/invite/reset`} style="display:inline-block;margin-left:6px">
                <button class="messages-danger-button" type="submit">Заменить ссылку</button>
              </form>
            ) : null}
          </div>
          {isOwner ? (
            <div class="messages-group-manage">
              <form method="post" action={`${path}/members/add`} style="display:inline-block;margin-right:12px">
                <label for="group_member_username" style="margin-right:5px">Добавить по логину:</label>
                <input id="group_member_username" type="text" name="username" maxlength={32} required />{" "}
                <button class="messages-small-button" type="submit">Добавить</button>
              </form>
              <form method="post" action={`${path}/delete`} style="display:inline-block" onsubmit="return confirm('Удалить групповой чат вместе со всей перепиской?')">
                <button class="messages-danger-button" type="submit">Удалить группу</button>
              </form>
            </div>
          ) : (
            <form class="messages-group-manage" method="post" action={`${path}/leave`} onsubmit="return confirm('Покинуть этот групповой чат?')">
              <button class="messages-danger-button" type="submit">Покинуть группу</button>
            </form>
          )}
        </div>
      </details>
      {thread.hasOlder && thread.olderBefore ? (
        <div class="messages-history-nav">
          <a href={`${path}?before=${thread.olderBefore}`}>Показать более ранние сообщения</a>
        </div>
      ) : history ? (
        <div class="messages-history-nav">Это начало переписки.</div>
      ) : null}
      {history ? (
        <div class="messages-history-nav">
          <a href={path}>Вернуться к новым сообщениям →</a>
        </div>
      ) : null}
      <div id="messages_log" class="messages-log" role="log" aria-live="polite" aria-relevant="additions">
        {thread.messages.length ? thread.messages.map((message) => (
          <MessageItemView key={message.id} message={message} />
        )) : (
          <div class="messages-log-empty">Группа создана. Напишите первое сообщение участникам.</div>
        )}
      </div>
      {!history ? (
        <form id="messages_compose" class="messages-compose" method="post" action={path}>
          <div class="messages-compose-error" role="alert">{error ?? ""}</div>
          <label for="message_body" style="display:block;padding-bottom:5px;font-weight:bold">
            Сообщение в группу «{group.title}»
          </label>
          <textarea
            id="message_body"
            name="body"
            maxlength={MESSAGE_MAX_LENGTH}
            placeholder="Напишите сообщение всем участникам…"
            required
          >{draft ?? ""}</textarea>
          <div class="messages-compose-bottom">
            <button class="messages-send" type="submit">Отправить</button>
            <span class="messages-compose-hint">
              <span class="messages-compose-count">{Array.from(draft ?? "").length}</span>/{MESSAGE_MAX_LENGTH}; Ctrl+Enter — отправить
            </span>
          </div>
        </form>
      ) : null}
    </section>
  );
};

export const GroupCreatePage: FC<{
  error?: string;
  title?: string;
  participants?: string;
}> = ({ error, title = "", participants = "" }) => (
  <div id="messages_app">
    <h1 class="h_page_header">Новый групповой чат</h1>
    <p><a href="/messages">← Вернуться к сообщениям</a></p>
    <div class="messages-group-create">
      {error ? <div class="messages-group-create-error" role="alert">{error}</div> : null}
      <form method="post" action="/messages/groups/new">
        <label for="group_title">Название группы</label>
        <input id="group_title" type="text" name="title" minlength={2} maxlength={80} value={title} required />
        <label for="group_participants">Участники</label>
        <textarea
          id="group_participants"
          name="participants"
          placeholder="Reader, Helper"
        >{participants}</textarea>
        <div class="messages-group-create-help">
          Необязательно. Укажите логины через запятую, пробел или с новой строки либо создайте чат и отправьте ссылку-приглашение. Себя добавлять не нужно.
        </div>
        <button class="messages-send" type="submit" style="float:none">Создать группу</button>
      </form>
    </div>
  </div>
);

export const GroupJoinPage: FC<{
  token: string;
  invite?: GroupInviteInfo | null;
  error?: string;
}> = ({ token, invite, error }) => (
  <div id="messages_app">
    <h1 class="h_page_header">Приглашение в группу</h1>
    <div class="messages-group-create">
      {error ? <div class="messages-group-create-error" role="alert">{error}</div> : null}
      {invite ? (
        <>
          <h2 style="margin-bottom:10px">{invite.title}</h2>
          <p class="messages-start-copy">
            В чате сейчас {invite.memberCount} {pluralize(invite.memberCount, "участник", "участника", "участников")}.
          </p>
          <form method="post" action={`/messages/groups/join/${encodeURIComponent(token)}`}>
            <button class="messages-send" type="submit" style="float:none">Присоединиться к чату</button>
          </form>
        </>
      ) : (
        <p><a href="/messages">Вернуться к сообщениям</a></p>
      )}
    </div>
  </div>
);

const StartView: FC<{ query: string; users: MessageUser[]; hasConversations: boolean }> = ({
  query,
  users,
  hasConversations,
}) => (
  <section class="messages-start">
    <h2 class="messages-start-title">
      {query ? `Поиск: ${query}` : hasConversations ? "Выберите переписку" : "Начните переписку"}
    </h2>
    <p class="messages-start-copy">
      {query
        ? users.length ? "Выберите пользователя, чтобы открыть диалог." : "Пользователь с таким логином не найден. Проверьте написание."
        : hasConversations
          ? "Откройте диалог слева или найдите пользователя по логину. Личные сообщения видны только вам и собеседнику."
          : "Найдите пользователя по логину. После первого сообщения диалог останется в этом разделе."}
    </p>
    {users.length ? (
      <div class="messages-people">
        {users.map((user) => (
          <a class="messages-person" href={`/messages/${encodeURIComponent(user.username)}`} key={user.id}>
            <img src={avatarSrc(user.avatarUrl)} alt="" />
            <span class="messages-person-name">{displayName(user)}</span>
            <span class="messages-person-detail">@{user.username} · написать личное сообщение</span>
          </a>
        ))}
      </div>
    ) : null}
  </section>
);

export const MessengerPage: FC<{
  currentUser: { id: number; username: string; unreadMessagesCount?: number };
  conversations: Array<ConversationListItem | GroupConversationListItem>;
  thread?: MessageThread | null;
  groupThread?: GroupThread | null;
  searchQuery?: string;
  searchResults?: MessageUser[];
  error?: string;
  managementError?: string;
  draft?: string;
  history?: boolean;
}> = ({
  currentUser,
  conversations,
  thread,
  groupThread,
  searchQuery = "",
  searchResults = [],
  error,
  managementError,
  draft,
  history = false,
}) => {
  const activeThread = thread ?? groupThread;
  const lastId = activeThread?.messages.at(-1)?.id ?? 0;
  const activeUsername = thread?.partner.username;
  const activeGroupId = groupThread?.group.id;
  const unreadTotal = currentUser.unreadMessagesCount
    ?? conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  return (
    <div
      id="messages_app"
      class={activeThread ? "messages-has-thread" : ""}
      data-last-id={lastId}
      data-conversation-id={groupThread ? `group:${groupThread.group.id}` : thread?.conversationId ?? undefined}
      data-history={history ? "1" : "0"}
      data-updates-url={!history
        ? groupThread
          ? `/messages/groups/${groupThread.group.id}/updates`
          : thread ? `/messages/${encodeURIComponent(thread.partner.username)}/updates` : undefined
        : undefined}
      data-events-url={!history
        ? groupThread
          ? `/messages/groups/${groupThread.group.id}/events`
          : thread ? `/messages/${encodeURIComponent(thread.partner.username)}/events` : undefined
        : undefined}
      data-read-through={thread?.readThroughId ?? 0}
    >
      <h1 class="h_page_header messages-heading">
        Личные сообщения
        <small>
          {unreadTotal
            ? `${unreadTotal} ${pluralize(unreadTotal, "непрочитанное сообщение", "непрочитанных сообщения", "непрочитанных сообщений")}`
            : "всё прочитано"}
        </small>
      </h1>
      <div class="messages-shell">
        <aside class="messages-nav" aria-label="Список диалогов">
          <h2 class="messages-nav-title">
            <span>Переписки</span>
            <a class="messages-new-group" href="/messages/groups/new">+ группа</a>
          </h2>
          <form class="messages-search" method="get" action="/messages">
            <div class="messages-search-row">
              <input
                class="messages-search-input"
                type="search"
                name="q"
                maxlength={32}
                value={searchQuery}
                placeholder="логин пользователя"
                aria-label="Найти пользователя по логину"
              />
              <button class="messages-search-button" type="submit">Найти</button>
            </div>
          </form>
          <nav class="messages-conversations">
            {conversations.length ? conversations.map((conversation) => (
              <ConversationLink
                key={`${conversation.kind}:${conversation.id}`}
                item={conversation}
                currentUserId={currentUser.id}
                activeUsername={activeUsername}
                activeGroupId={activeGroupId}
              />
            )) : (
              <div class="messages-empty-nav">Диалогов пока нет. Найдите пользователя выше и напишите ему.</div>
            )}
          </nav>
        </aside>
        <main class="messages-main">
          {groupThread ? (
            <GroupThreadView
              thread={groupThread}
              currentUserId={currentUser.id}
              error={error}
              managementError={managementError}
              draft={draft}
              history={history}
            />
          ) : thread ? (
            <ThreadView thread={thread} error={error} draft={draft} history={history} />
          ) : (
            <StartView query={searchQuery} users={searchResults} hasConversations={conversations.length > 0} />
          )}
        </main>
      </div>
    </div>
  );
};
