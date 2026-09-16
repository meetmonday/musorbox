import type { FC } from "hono/jsx";
import type { TopicListItem } from "../topics/service";
import { replyCountText } from "../core/utils";
import { Avatar, Pagination, topicUrl } from "../topics/components";
import type { TagGroup } from "./service";

export const ForumPagination: FC<{
  page: number;
  total: number;
  perPage: number;
  basePath: string;
}> = (props) => <Pagination {...props} />;

export const TagFilter: FC<{ os: TagGroup[]; quest: TagGroup[] }> = ({ os, quest }) => (
  <div>
    <h2 class="h_tags_menu">
      <a href="/public/b_questions/">Форум</a>
    </h2>
    <div class="div_tags_menu">
      <div class="div_tags_menu_block1">
        <div class="div_tags_menu_block2">
          <div class="h_tags_menu">Операционная система</div>
          {os.map((t) => (
            <h3 key={t.id}>
              <a class={`span_tags_menu${t.weight}`} href={`/public/b_questions/tags/${t.slug}/`}>
                <nobr>{t.name}</nobr>
              </a>
            </h3>
          ))}
        </div>
        <br class="clear" />
        <div class="div_tags_menu_block2">
          <div class="h_tags_menu">Темы</div>
          {quest.map((t) => (
            <h3 key={t.id}>
              <a class={`span_tags_menu${t.weight}`} href={`/public/b_questions/tags/${t.slug}/`}>
                <nobr>{t.name}</nobr>
              </a>
            </h3>
          ))}
        </div>
        <br class="clear" />
      </div>
    </div>
  </div>
);

export const ThreadRow: FC<{ topic: TopicListItem; rowIndex: number }> = ({ topic, rowIndex }) => {
  const dark = rowIndex % 2 === 1 ? " div_forum_dark" : "";
  return (
    <div class={`div_row${dark}`} id={`div_topic_${topic.id}`}>
      <div class="div_cell div_forum_tags">
        {topic.tags.map((t) => (
          <a key={t.id} href={`/public/b_questions/tags/${t.slug}/`}>
            {t.name}
          </a>
        ))}
      </div>
      <div class="div_cell div_forum_avatar">
        <Avatar src={topic.authorAvatar} size="24px" />
      </div>
      <div class="div_cell div_forum_content">
        <a href={topicUrl(topic)} class="black div_forum_caption">
          {topic.title}
        </a>
        <div class="div_forum_author">
          <a href={`/users/${topic.authorUsername}/`} class="dark2">
            {topic.authorUsername}
          </a>
          <span class="dark">, {replyCountText(topic.commentCount)}</span>
        </div>
      </div>
      <div class="div_cell div_forum_answer">
        <a href={topicUrl(topic)} class="a_forum_answer">
          Ответить →
        </a>
      </div>
    </div>
  );
};

export const ThreadList: FC<{ items: TopicListItem[] }> = ({ items }) => (
  <div class="div_table div_forum_table">
    {items.map((t, i) => (
      <ThreadRow key={t.id} topic={t} rowIndex={i} />
    ))}
  </div>
);