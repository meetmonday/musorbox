import type { FC } from "hono/jsx";
import type { SessionUser } from "../core/middleware";
import type { ModerationOverview as Overview } from "./service";

const sections = { topics: "Топики", comments: "Комментарии", users: "Пользователи", log: "Журнал" };
const actions: Record<string, string> = {
  hide_topic: "Топик скрыт", show_topic: "Топик восстановлен",
  hide_comment: "Комментарий скрыт", show_comment: "Комментарий восстановлен",
  ban: "Пользователь заблокирован", unban: "Пользователь разблокирован",
};
const roles: Record<string, string> = { user: "Пользователь", author: "Автор", editor: "Редактор", admin: "Администратор" };

function listUrl(data: Overview, page = data.page): string {
  return `/moderation?${new URLSearchParams({ section: data.section, q: data.query, filter: data.filter, page: String(page) })}`;
}

const ActionForm: FC<{ action: string; label: string; returnTo: string; restore?: boolean }> = ({ action, label, returnTo, restore }) => (
  <form method="post" action={action} class="mod-action">
    <input type="hidden" name="returnTo" value={returnTo} />
    <label>Причина <input name="reason" maxlength={200} required value={restore ? "восстановлен" : undefined} placeholder="Укажите причину" /></label>
    <button type="submit">{label}</button>
  </form>
);

export const ModerationPage: FC<{ data: Overview; user: SessionUser; message?: string; error?: string }> = ({ data, user, message, error }) => {
  const returnTo = listUrl(data);
  return (
    <section class="text12 moderation" aria-labelledby="moderation-title">
      <style>{`
        .moderation { padding: 12px; overflow-wrap: anywhere; }
        .moderation h1 { margin-top: 0; }
        .mod-nav, .mod-search, .mod-action, .mod-pages { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .mod-nav { margin: 12px 0; border-bottom: 1px solid #ccc; padding-bottom: 8px; }
        .mod-nav a { padding: 4px 8px; }
        .mod-nav a[aria-current="page"] { background: #e5eef4; font-weight: bold; color: #222; }
        .mod-search { padding: 10px; background: #f1f1f1; }
        .moderation input, .moderation select, .moderation button { font: inherit; padding: 5px; box-sizing: border-box; max-width: 100%; }
        .moderation button { cursor: pointer; }
        .moderation :focus-visible { outline: 2px solid #2673a7; outline-offset: 2px; }
        .mod-entry { padding: 12px 0; border-bottom: 1px solid #ccc; }
        .mod-entry h2 { font-size: 14px; margin: 0 0 4px; }
        .mod-entry p { margin: 5px 0; }
        .mod-action { margin-top: 8px; }
        .mod-action label { flex: 1 1 180px; }
        .mod-action input { width: 100%; }
        .mod-pages { justify-content: space-between; margin-top: 16px; }
        .mod-status { padding: 8px; background: #e8f6e8; }
        .mod-error { padding: 8px; background: #fdeef0; color: #a33; }
        .mod-counts { margin: 8px 0; }
      `}</style>
      <h1 class="h_page_header" id="moderation-title">Модерация</h1>
      <p class="dark mod-counts">Скрыто: {data.stats.hiddenTopics} топиков, {data.stats.hiddenComments} комментариев. Заблокировано: {data.stats.bannedUsers}. Действий: {data.stats.modActions}.</p>
      <nav class="mod-nav" aria-label="Разделы модерации">
        {Object.entries(sections).map(([key, label]) => <a href={`/moderation?section=${key}`} aria-current={data.section === key ? "page" : undefined}>{label}</a>)}
      </nav>
      {message ? <p role="status" class="mod-status">{message}</p> : null}
      {error ? <p role="alert" class="mod-error">{error}</p> : null}
      <form method="get" action="/moderation" class="mod-search">
        <input type="hidden" name="section" value={data.section} />
        <label>Поиск <input type="search" name="q" value={data.query} maxlength={100} /></label>
        {data.section !== "log" ? <label>Показать <select name="filter">
          <option value="all" selected={data.filter === "all"}>Все</option>
          <option value="restricted" selected={data.filter === "restricted"}>{data.section === "users" ? "Заблокированные" : "Скрытые"}</option>
        </select></label> : null}
        <button type="submit">Найти</button>
        <a href={`/moderation?section=${data.section}`}>Сбросить</a>
      </form>
      <p class="dark">Найдено: {data.total}</p>
      {data.section === "topics" || data.section === "comments" ? <p class="dark">Скрытие убирает запись с сайта и отправляет удаление в федерацию для локальных записей. Восстановление действует только на этом сайте.</p> : null}
      {!data.total ? <p>Записей нет. Измените запрос или фильтр.</p> : null}
      {data.topics.map((topic) => <article class="mod-entry">
        <h2><a href={`/topics/${topic.id}/${topic.slug}`}>{topic.title}</a></h2>
        <p>#{topic.id} · <a href={`/users/${topic.author}/`}>{topic.author}</a> · {topic.hidden ? "Скрыт" : "Опубликован"}</p>
        <ActionForm action={`/moderation/topics/${topic.id}/${topic.hidden ? "show" : "hide"}`} label={topic.hidden ? "Восстановить топик" : "Скрыть топик"} restore={topic.hidden} returnTo={returnTo} />
      </article>)}
      {data.comments.map((comment) => <article class="mod-entry">
        <h2><a href={`/topics/${comment.topicId}/${comment.topicSlug}#div_comment_${comment.id}`}>Комментарий #{comment.id}</a></h2>
        <p class="dark">{comment.author ?? "Удалённый пользователь"} · {comment.hidden ? "Скрыт" : "Опубликован"}</p>
        <p>{comment.body.replace(/<[^>]*>/g, " ")}</p>
        <ActionForm action={`/moderation/comments/${comment.id}/${comment.hidden ? "show" : "hide"}`} label={comment.hidden ? "Восстановить комментарий" : "Скрыть комментарий"} restore={comment.hidden} returnTo={returnTo} />
      </article>)}
      {data.users.map((target) => {
        const canManage = target.id !== user.id && target.role !== "admin" && (user.role === "admin" || target.role === "user" || target.role === "author");
        return <article class="mod-entry">
          <h2><a href={`/users/${target.username}/`}>{target.username}</a></h2>
          <p>#{target.id} · {roles[target.role] ?? target.role} · {target.banned ? "Заблокирован" : "Активен"}</p>
          {target.reason ? <p>Причина: {target.reason}</p> : null}
          {canManage ? <ActionForm action={`/moderation/users/${target.id}/${target.banned ? "unban" : "ban"}`} label={target.banned ? "Разблокировать" : "Заблокировать"} restore={target.banned} returnTo={returnTo} /> : <p class="dark">Блокировка этой учётной записи вам недоступна.</p>}
        </article>;
      })}
      {data.log.map((entry) => <article class="mod-entry">
        <h2>{actions[entry.action] ?? entry.action}</h2>
        <p class="dark"><time datetime={entry.createdAt.toISOString()}>{entry.createdAt.toLocaleString("ru-RU", { timeZone: "UTC" })} UTC</time> · {entry.moderator ?? "Удалённый модератор"} · #{entry.entityId}</p>
        <p>{entry.reason}</p>
      </article>)}
      <nav class="mod-pages" aria-label="Страницы результатов">
        {data.page > 1 ? <a rel="prev" href={listUrl(data, data.page - 1)}>← Назад</a> : <span />}
        <span>Страница {data.page} из {data.pages}</span>
        {data.page < data.pages ? <a rel="next" href={listUrl(data, data.page + 1)}>Далее →</a> : <span />}
      </nav>
    </section>
  );
};
