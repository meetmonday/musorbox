import type { FC } from "hono/jsx";
import type { EditableCategory } from "../topics/service";
import type { TagGroup } from "../forum/service";

export const EDITOR_ID = "topic";
export const CONTENT_FIELD = "content";

export const editorHead = (
  <>
    <link rel="stylesheet" href="/Bredacture/editor.css" />
    <link rel="stylesheet" href="/Bredacture/tapes.css" />
    <script src="/Bredacture/editor_4_mini_.js"></script>
  </>
);

const EDITOR_OPTIONS = JSON.stringify({
  h2: true,
  b: true,
  i: true,
  s: true,
  ul: true,
  ol: true,
  blockquote: true,
  createlink: true,
  link: true,
  unlink: true,
  image: true,
  video: true,
  cut: true,
});

/**
 * Bredacture Lite — по документации (https://emacho.ru/bredacture/) урезанная
 * версия редактора, предназначенная для написания комментариев.
 */
export const COMMENT_EDITOR_ID = "comment";

const COMMENT_EDITOR_OPTIONS = JSON.stringify({
  b: true,
  i: true,
  s: true,
  ul: true,
  ol: true,
  blockquote: true,
  link: true,
  unlink: true,
});

const commentEditorInitJS = `window.COMMENT_EDITOR_OPTIONS = ${COMMENT_EDITOR_OPTIONS};
window.initCommentEditor = function (id, value) {
  if (typeof Bredacture__lite !== "function") return false;
  id = String(id).replace(/[^A-Za-z0-9_]/g, "");
  var host = document.getElementById("lite_" + id);
  if (!host) return false;
  Bredacture__lite(id, value || "", window.COMMENT_EDITOR_OPTIONS, "auto");
  return true;
};
window.commentEditorValue = function (form, id) {
  id = String(id).replace(/[^A-Za-z0-9_]/g, "");
  var ed = window.e_lite ? window.e_lite[id] : null;
  var field = document.getElementById("input_html_" + id);
  if (!ed || !field || (form && !form.contains(field))) return null;
  try { ed.fix_value(); } catch (e) {}
  return field.value;
};`;

// tr-editor.css переопределяет .div_new_comment в белую панель с тенью — в оригинале этот
// класс и оборачивает обычную ссылку «Ответить». Панель оставляем только для контейнера
// с открытой формой (класс div_new_comment_open переключает app.js).
const commentEditorStyles = `
.div_new_comment {
  margin: 3px 0 0;
  padding-bottom: 3px;
  width: auto;
  min-width: 0;
  background: transparent;
  box-shadow: none;
}
.div_new_comment_open {
  margin: 3px 0 0 5px;
  padding-bottom: 10px;
  width: 100%;
  min-width: 275px;
  background: #fff;
  box-shadow: 0 0 20px 0 rgba(0, 0, 0, 0.5);
}
.div_new_comment_open a.a_reply {
  display: none;
}
`;

/** Стили + скрипт Lite-редактора и хелперы initCommentEditor/commentEditorValue. */
export const commentEditorHead = (
  <>
    <link rel="stylesheet" href="/Bredacture/tr-editor.css" />
    <style dangerouslySetInnerHTML={{ __html: commentEditorStyles }} />
    <script src="/Bredacture/editor-lite_21_mini_.js"></script>
    <script dangerouslySetInnerHTML={{ __html: commentEditorInitJS }} />
  </>
);

export type NewTopicFormProps = {
  categories: EditableCategory[];
  os: TagGroup[];
  quest: TagGroup[];
  title?: string;
  categoryId?: number;
  tagIds?: number[];
  body?: string;
  error?: string;
  action?: string;
  editing?: boolean;
};

export const NewTopicForm: FC<NewTopicFormProps> = ({
  categories,
  os,
  quest,
  title = "",
  categoryId,
  tagIds = [],
  body = "",
  error,
  action = "/new_topic/",
  editing = false,
}) => {
  const checked = new Set(tagIds);
  const initJS = `Bredacture_('${EDITOR_ID}', ${JSON.stringify(body)}, ${EDITOR_OPTIONS}, 'auto');`
    + `document.getElementById('frm_new_topic').onsubmit=function(){e_['${EDITOR_ID}'].fix_value();return true};`;
  return (
    <div>
      <h1 class="h_page_header">{editing ? "Редактирование топика" : "Новый топик"}</h1>
      {error ? (
        <div class="div_instruction" style="color:#c33">{error}</div>
      ) : null}
      <form id="frm_new_topic" method="post" action={action}>
        <div class="div_new_topic">
          <div class="div_form_cell" style="width:100%">
            <h3>Заголовок</h3>
            <input type="text" name="title" class="input_new_topic" maxlength={200} value={title} />
          </div>
          <div class="div_form_cell div_new_topic_margin">
            <h3>Раздел</h3>
            <select name="category_id" class="input_select_cat">
              {categories.map((c) => (
                <option key={c.id} value={c.id} selected={c.id === categoryId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div class="div_form_cell">
            <h3>Операционная система</h3>
            {os.map((t) => (
              <label key={t.id} style="display:block;white-space:nowrap">
                <input type="checkbox" name="tag_ids" value={String(t.id)} checked={checked.has(t.id)} /> {t.name}
              </label>
            ))}
          </div>
          <div class="div_form_cell">
            <h3>Темы</h3>
            {quest.map((t) => (
              <label key={t.id} style="display:block;white-space:nowrap">
                <input type="checkbox" name="tag_ids" value={String(t.id)} checked={checked.has(t.id)} /> {t.name}
              </label>
            ))}
          </div>
          <br class="clear" />
          <h3>Текст</h3>
          <div id={`div_editor_${EDITOR_ID}`} />
          <div style="margin-top:10px;clear:both">
            <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
              {editing ? "Сохранить изменения" : "Добавить топик"}
            </button>
            <span class="dark">
              <span class="italic">или</span> <a href="/" class="a_dashed">отменить</a>
            </span>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: initJS }} />
      </form>
    </div>
  );
};