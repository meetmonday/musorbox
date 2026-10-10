import type { FC } from "hono/jsx";
import type { TgThread, TgThreadRow } from "./service";
import { config } from "../core/config";
import { renderPage } from "../layout/layout";

export type TelegramSettingsView = {
  /** Токен в открытом виде не показываем — только маска. */
  tokenMask: string;
  hasToken: boolean;
  chatId: string;
  mirrorNewTopics: boolean;
  webhookUrl: string;
  configured: boolean;
  threads: TgThreadRow[];
  message?: string;
  error?: string;
};

export type TelegramCheckView = {
  ok: boolean;
  lines: string[];
};

export const TelegramSettingsPage: FC<TelegramSettingsView> = ({
  tokenMask,
  hasToken,
  chatId,
  mirrorNewTopics,
  webhookUrl,
  configured,
  threads,
  message,
  error,
}) => (
  <div class="text12" id="telegram_settings">
    <h1 class="h_page_header">Telegram</h1>
    <p>
      <a href="/moderation">Вернуться в модерацию</a>
    </p>
    <div class="div_block">
      <h2>Подключение</h2>
      <p>
        Каждый новый топик сайта создаёт тему в обсуждении Telegram, а каждый ответ в теме —
        комментарий на сайте. Бот должен быть администратором чата с правом управления темами.
      </p>
      <p>
        Состояние:{" "}
        {configured ? (
          <strong>интеграция включена</strong>
        ) : (
          <strong>не настроено</strong>
        )}
      </p>
      {message ? <p role="status"><strong>{message}</strong></p> : null}
      {error ? <p role="alert" style="color:#c33"><strong>{error}</strong></p> : null}
      <form method="post" action="/settings/telegram">
        <p>
          <label for="tg_bot_token">Токен бота</label>
          <br />
          <input
            id="tg_bot_token"
            class="input_auth"
            type="text"
            name="bot_token"
            value=""
            placeholder={hasToken ? `сохранён: ${tokenMask}` : "123456:ABC-DEF..."}
            autocomplete="off"
            spellcheck={false}
            style="box-sizing:border-box;width:100%"
          />
          {hasToken ? <span class="dark">Пустое поле — оставить прежний токен.</span> : null}
        </p>
        <p>
          <label for="tg_chat_id">ID чата с топиками</label>
          <br />
          <input
            id="tg_chat_id"
            class="input_auth"
            type="text"
            name="chat_id"
            value={chatId}
            placeholder="-1001234567890"
            autocomplete="off"
            style="box-sizing:border-box;width:100%"
          />
          <span class="dark">Например <code>-1001234567890</code> (супергруппа с топиками).</span>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              name="mirror_new_topics"
              value="1"
              checked={mirrorNewTopics}
            />{" "}
            Создавать тему чата для каждого нового топика
          </label>
        </p>
        <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
          Сохранить
        </button>
      </form>
    </div>

    <div class="div_block">
      <h2>Приём сообщений</h2>
      <p>
        Адрес вебхука:{" "}
        {webhookUrl ? (
          <code style="word-break:break-all">{webhookUrl}</code>
        ) : (
          <span class="dark">появится после сохранения настроек</span>
        )}
      </p>
      <p class="dark">
        Секрет приходит в заголовке <code>X-Telegram-Bot-Api-Secret-Token</code>: посторонние
        запросы на адрес Telegram отбрасываются.
      </p>
      <form method="post" action="/settings/telegram/webhook" style="display:inline">
        <input type="hidden" name="action" value="set" />
        <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
          Установить вебхук
        </button>
      </form>{" "}
      <form method="post" action="/settings/telegram/webhook" style="display:inline">
        <input type="hidden" name="action" value="delete" />
        <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
          Удалить вебхук
        </button>
      </form>
    </div>

    <div class="div_block">
      <h2>Проверка связи</h2>
      <form method="post" action="/settings/telegram/test">
        <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
          Проверить бота и чат
        </button>
      </form>
    </div>

    <div class="div_block">
      <h2>Связанные темы ({threads.length})</h2>
      {threads.length === 0 ? (
        <p class="dark">Пока ни один топик не связан с темой чата.</p>
      ) : (
        <table cellpadding="4" cellspacing="0" style="width:100%">
          <tbody>
            {threads.map((thread) => (
              <tr>
                <td>
                  <a href={`/topics/${thread.topicId}/${thread.topicSlug}`}>{thread.topicTitle}</a>
                  {thread.topicHidden ? <span class="dark"> (скрыт)</span> : null}
                  <br />
                  <span class="dark">
                    тема {thread.messageThreadId} · сообщений зеркалируется: {thread.mirroredComments}
                  </span>
                </td>
                <td style="text-align:right;white-space:nowrap">
                  <form method="post" action={`/topics/${thread.topicId}/telegram/delete`} style="display:inline">
                    <button type="submit" class="blue" style="padding:3px 10px;border:0;cursor:pointer">
                      Удалить тему
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="dark">
        «Удалить тему» убирает тему из чата и отвязку от топика; сам топик на сайте остаётся.
      </p>
    </div>

    <div class="div_block">
      <h2>Как это работает</h2>
      <ul>
        <li>заголовки, списки, ссылки, код, цитаты и картинки — через «богатые» сообщения Bot API;</li>
        <li>правка и удаление комментария на сайте правит и убирает сообщение в чате;</li>
        <li>правка сообщения в чате правит комментарий на сайте;</li>
        <li>автор из чата получает профиль со своим логином, именем и аватаром.</li>
      </ul>
      <p class="dark">
        Боты не получают от Telegram апдейтов об удалении сообщений в группе, поэтому
        свой комментарий автор убирает с сайта ответом <code>/del</code> на своё же
        сообщение в теме. Сайт остаётся источником истины: удаление и скрытие
        комментария модератором убирают сообщение из чата.
      </p>
      <p class="dark">
        Из чата на сайт попадут текст, фото и файлы-картинки; голосовые, стикеры и
        видео комментариями не становятся.
      </p>
    </div>
  </div>
);

/** Ссылка на тему чата и кнопки управления — на странице топика. */
export const TelegramTopicLink: FC<{
  thread: TgThread | null;
  configured: boolean;
  canManage: boolean;
  topicId: number;
  chatUsername?: string;
}> = ({ thread, configured, canManage, topicId, chatUsername }) => {
  if (!configured) return null;
  if (!thread) {
    if (!canManage) return null;
    return (
      <div class="div_block">
        <h2>Telegram</h2>
        <p class="dark">Этот топик не связан с темой в чате.</p>
        <form method="post" action={`/topics/${topicId}/telegram`}>
          <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
            Создать тему в Telegram
          </button>
        </form>
      </div>
    );
  }
  const href = chatUsername
    ? `https://t.me/${chatUsername}/${thread.messageThreadId}`
    : `https://t.me/c/${String(thread.chatId).replace(/^-100/, "")}/${thread.messageThreadId}`;
  return (
    <div class="div_block">
      <h2>Telegram</h2>
      <p>
        Обсуждение топика идёт и в <a href={href} rel="nofollow noopener" target="_blank">теме чата Telegram</a>:
        ответы оттуда появляются здесь комментариями.
      </p>
      {canManage ? (
        <form method="post" action={`/topics/${topicId}/telegram/delete`}>
          <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
            Отвязать тему
          </button>
        </form>
      ) : null}
    </div>
  );
};

export const TelegramCheckResult: FC<TelegramCheckView> = ({ ok, lines }) => (
  <div class="div_block">
    <h2>Результат проверки</h2>
    <p role="status">
      <strong style={{ color: ok ? "#080" : "#c33" }}>{ok ? "Связь есть" : "Ошибка"}</strong>
    </p>
    <ul>
      {lines.map((line) => (
        <li>{line}</li>
      ))}
    </ul>
    <p>
      <a href="/settings/telegram">Назад к настройкам</a>
    </p>
  </div>
);

type LayoutUser = Parameters<typeof renderPage>[0]["user"];

/** Готовая страница настроек (рендерим здесь, чтобы в маршрутах не было JSX). */
export async function renderTelegramSettingsHtml(
  user: LayoutUser,
  view: TelegramSettingsView,
): Promise<string> {
  const html = await renderPage({
    title: `Telegram — ${config.siteName}`,
    user,
    children: <TelegramSettingsPage {...view} />,
  });
  return `<!DOCTYPE html>${html}`;
}

/** Готовая страница результата проверки связи. */
export async function renderTelegramCheckHtml(
  user: LayoutUser,
  view: TelegramCheckView,
): Promise<string> {
  const html = await renderPage({
    title: `Проверка Telegram — ${config.siteName}`,
    user,
    children: <TelegramCheckResult {...view} />,
  });
  return `<!DOCTYPE html>${html}`;
}
