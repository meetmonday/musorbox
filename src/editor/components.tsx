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

export type NewTopicFormProps = {
  categories: EditableCategory[];
  os: TagGroup[];
  quest: TagGroup[];
  title?: string;
  categoryId?: number;
  tagIds?: number[];
  body?: string;
  error?: string;
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
}) => {
  const checked = new Set(tagIds);
  const initJS = `Bredacture_('${EDITOR_ID}', ${JSON.stringify(body)}, ${EDITOR_OPTIONS}, 'auto');`
    + `document.getElementById('frm_new_topic').onsubmit=function(){e_['${EDITOR_ID}'].fix_value();return true};`;
  return (
    <div>
      <h1 class="h_page_header">Новый топик</h1>
      {error ? (
        <div class="div_instruction" style="color:#c33">{error}</div>
      ) : null}
      <form id="frm_new_topic" method="post" action="/new_topic/">
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
              Добавить топик
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