import type { FC } from "hono/jsx";
import type { listNotifications } from "./service";
import { formatDate } from "../core/utils";

const labels = { reply: "ответил на ваш комментарий", topic_reply: "написал в вашем топике", mention: "упомянул вас", like: "оценил вашу публикацию", mod: "Модерация" };

export const NotificationList: FC<{ items: Awaited<ReturnType<typeof listNotifications>>; page: number }> = ({ items, page }) => (
  <div class="text12">
    <h1 class="h_page_header">Уведомления</h1>
    <form method="post" action="/notifications/read"><button type="submit">Прочитать всё</button></form>
    {!items.length ? <p>Пока нет уведомлений. Здесь появятся ответы и упоминания.</p> : null}
    {items.slice(0, 20).map((n) => (
      <div style={`padding:12px 0;border-bottom:1px solid #ccc;${n.read ? "" : "font-weight:bold"}`}>
        <div>{n.type === "mod" ? n.message : `${n.actorName ?? n.remoteName ?? "Пользователь"} ${labels[n.type]}`}</div>
        {n.topicId && !n.hidden ? <a href={`/topics/${n.topicId}/${n.slug}${n.commentId ? `#div_comment_${n.commentId}` : ""}`}>{n.title}</a> : null}
        <div class="dark">{formatDate(n.createdAt)}</div>
        {!n.read ? <form method="post" action="/notifications/read"><input type="hidden" name="id" value={n.id} /><button type="submit">Прочитано</button></form> : null}
      </div>
    ))}
    {page > 1 ? <a href={`/notifications?page=${page - 1}`}>Назад</a> : null}{" "}
    {items.length > 20 ? <a href={`/notifications?page=${page + 1}`}>Дальше</a> : null}
  </div>
);
