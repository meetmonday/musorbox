import type { FC } from "hono/jsx";
import { formatDate, replyCountText, voteBarWidths, excerpt } from "../core/utils";
import type { TopicListItem, TopicDetail } from "./service";

export function topicUrl(t: TopicListItem | TopicDetail): string {
  return `/topics/${t.id}/${t.slug}`;
}

export function avatarSrc(url: string | null): string {
  return url ?? "/images/default_avatar.png";
}

export const Avatar: FC<{ src: string | null; size?: string; className?: string }> = ({
  src,
  size,
  className,
}) => (
  <img
    src={avatarSrc(src)}
    className={className}
    style={size ? { width: size, height: size } : undefined}
    alt=""
  />
);

export const VoteBar: FC<{ up: number; down: number; total?: number }> = ({ up, down, total = 120 }) => {
  const { upPx, downPx } = voteBarWidths(up, down, total);
  const score = up - down;
  return (
    <>
      <div class="right div_topic_votes_current">
        <nobr>{score > 0 ? `+${score}` : String(score)}</nobr>
      </div>
      <div class="div_topic_votes_bar">
        <div style={`background:#1FB6F2;float:left;width:${upPx}px;height:4px`}> </div>
        <div style={`background:#999999;float:left;width:${downPx}px;height:4px`}> </div>
        <br class="clear" />
      </div>
      <div class="right div_topic_votes_advanced">
        <span>{up} нравится</span>, <span>{down} не нравится</span>
      </div>
    </>
  );
};

export const TopicCard: FC<{ topic: TopicListItem }> = ({ topic }) => (
  <div class="div_topic" id={`div_topic_${topic.id}`}>
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td class="td1">
          <a href={`/users/${topic.authorUsername}`}>
            <Avatar src={topic.authorAvatar} size="48px" />
          </a>
        </td>
        <td class="td2">
          <div class="dark" style="font-size:1.2em">
            <a href={`/users/${topic.authorUsername}`}>{topic.authorUsername}</a>,{" "}
            {formatDate(topic.createdAt)}
          </div>
          <h1 class="h_topic_caption">
            <a href={topicUrl(topic)} class="black">
              {topic.title}
            </a>
          </h1>
        </td>
      </tr>
    </table>
    <div class="div_text">
      <div class="div_full_screens">
        {topic.leadImage ? (
          <div class="div_image_news div_image_zoom">
            <a>
              <img src={topic.leadImage} style="max-width:380px;height:auto" alt={topic.title} />
            </a>
          </div>
        ) : null}
      </div>
      <div style="font-size:1.3em;line-height:1.5">{excerpt(topic.body, 220)}</div>
      {topic.body.length > 220 ? (
        <a href={topicUrl(topic)} class="dark2" style="font-size:1.2em">
          Читать дальше →
        </a>
      ) : null}
      <br class="clear" />
    </div>
    <table class="div_topic_bottom" cellpadding="0" cellspacing="0">
      <tr>
        <td class="div_topic_votes_buttons">
          <a
            class="blue a_nobackground"
            style="padding:5px 10px"
            onclick="return false"
            href="#"
          >
            +
          </a>
          <a
            class="blue a_nobackground"
            style="padding:5px 10px"
            onclick="return false"
            href="#"
          >
            −
          </a>
        </td>
        <td style="width:200px">
          <VoteBar up={topic.votesUp} down={topic.votesDown} />
        </td>
        <td>
          <div class="a_trashcut">
            <a href={topicUrl(topic)}>
              {topic.commentCount > 0 ? (
                <>{replyCountText(topic.commentCount)}, обсудить</>
              ) : (
                <>Обсудить</>
              )}
            </a>
          </div>
        </td>
      </tr>
    </table>
    {topic.tags.length > 0 ? (
      <div class="div_topic_caption_tags">
        {topic.tags.map((t) => (
          <span key={t.id}>
            <a href={`/public/${topic.categorySlug}/tags/${t.slug}/`}>#{t.name}</a>{" "}
          </span>
        ))}
      </div>
    ) : null}
  </div>
);

export const FeaturedCarousel: FC<{ items: TopicListItem[] }> = ({ items }) => (
  <noindex>
    <div class="div_table clear adh2" id="div_top_news_block">
      <div class="div_row">
        <div id="div_top_news_caption" class="white">
          Интересное
        </div>
        {items.map((t) => (
          <div class="div_cell div_top_news_b1" key={t.id}>
            <a
              class="div_top_news_b2"
              href={topicUrl(t)}
              style={
                t.leadImage
                  ? `background: url(${t.leadImage}) no-repeat center center; background-size: cover;`
                  : `background: url(/img/blank-dark.png) #e7e7e7 no-repeat center center;`
              }
            >
              <div class="div_top_news_text" align="center">
                <span>{t.title}</span>
              </div>
            </a>
          </div>
        ))}
      </div>
    </div>
  </noindex>
);

export const Leaderboard: FC<{
  authors: { id: number; username: string; avatar: string | null; score: number }[];
  commenters: { id: number; username: string; avatar: string | null; score: number }[];
}> = ({ authors, commenters }) => (
  <div class="div_table">
    <div class="div_row">
      <div class="div_cell div_half">
        <div class="div_tape_top_left2">Лучшие авторы недели</div>
        <div class="div_panel_view" style="background:white">
          {authors.map((u, i) => (
            <div class="div_topic_min" key={u.id}>
              <Avatar src={u.avatar} size="24px" className="img_topic_min_avatar" />
              <span>{i + 1}. </span>
              <a href={`/users/${u.username}`}>{u.username}</a>
              <span class="dark">{u.score}</span>
            </div>
          ))}
        </div>
      </div>
      <div class="div_cell div_half">
        <div class="div_tape_top_left2">Лучшие комментаторы недели</div>
        <div class="div_panel_view" style="background:white">
          {commenters.map((u, i) => (
            <div class="div_topic_min" key={u.id}>
              <Avatar src={u.avatar} size="24px" className="img_topic_min_avatar" />
              <span>{i + 1}. </span>
              <a href={`/users/${u.username}`}>{u.username}</a>
              <span class="dark">{u.score}</span>
            </div>
          ))}
          {commenters.length === 0 ? <div class="dark" style="padding:5px">Пока нет данных</div> : null}
        </div>
      </div>
    </div>
  </div>
);

export const Pagination: FC<{
  page: number;
  total: number;
  perPage: number;
  basePath: string;
}> = ({ page, total, perPage, basePath }) => {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pages);
  const items: (number | string)[] = [];
  const windowSize = 3;

  if (pages <= 1) return <br class="clear" />;

  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= windowSize) {
      items.push(p);
      continue;
    }
    const last = items[items.length - 1];
    if (last !== "..") items.push("..");
  }

  const pageUrl = (p: number) => `${basePath}/page_topics/${p}/`;

  return (
    <div class="div_navigator_new">
      {current < pages ? (
        <a href={pageUrl(current + 1)} class="dark2">
          →
        </a>
      ) : null}
      <span class="span_navigator_pages">
        {items.map((it, i) =>
          typeof it === "string" ? (
            <span key={`e${i}`}> .. </span>
          ) : it === current ? (
            <span key={it} class="span_item_active">
              {it}
            </span>
          ) : (
            <a key={it} href={pageUrl(it)} class="span_item">
              {it}
            </a>
          ),
        )}
      </span>
    </div>
  );
};

export const TopicMini: FC<{ topic: TopicListItem; showAuthor?: boolean; arrow?: boolean }> = ({
  topic,
  showAuthor = true,
  arrow,
}) => (
  <div class="div_topic_min" id={`div_topic_min_${topic.id}`}>
    <Avatar src={topic.authorAvatar} size="24px" className="img_topic_min_avatar" />
    <span>
      <a href={topicUrl(topic)}>{topic.title}</a>
    </span>
    <span class="dark">
      {topic.commentCount > 0 ? ` [${topic.commentCount}]` : ""}
      {showAuthor ? (
        <>
          {" — "}
          <a href={`/users/${topic.authorUsername}`}>{topic.authorUsername}</a>
        </>
      ) : null}
      {arrow ? " →" : ""}
    </span>
  </div>
);

export const TopicDetailView: FC<{ topic: TopicDetail }> = ({ topic }) => {
  const isForum = topic.categoryType === "forum";
  return (
    <div class="div_topic" id={`div_topic_${topic.id}`}>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td class="td1">
            <a href={`/users/${topic.authorUsername}`}>
              <Avatar src={topic.authorAvatar} size="48px" />
            </a>
          </td>
          <td class="td2">
            <div class="dark" style="font-size:1.2em">
              <a href={`/users/${topic.authorUsername}`} class="dark">
                {topic.authorUsername}
              </a>
              , {formatDate(topic.createdAt)}
            </div>
            <h1 class="h_topic_caption">
              <a href={topicUrl(topic)} class="black">
                {topic.title}
              </a>
            </h1>
            {!isForum ? (
              <div class="div_topic_caption_tags">
                <a href={`/public/${topic.categorySlug}/`} class="dark">
                  {topic.categoryName}
                </a>
                {topic.tags.map((t) => (
                  <span key={t.id}>
                    {" "}
                    <a href={`/public/${topic.categorySlug}/tags/${t.slug}/`}>#{t.name}</a>
                  </span>
                ))}
              </div>
            ) : (
              <div class="div_topic_caption_tags">
                {topic.tags.map((t) => (
                  <span key={t.id}>
                    <a href={`/public/${topic.categorySlug}/tags/${t.slug}/`}>#{t.name}</a>{" "}
                  </span>
                ))}
              </div>
            )}
          </td>
        </tr>
      </table>
      <div class="div_text">
        <div class="div_full_screens">
          {topic.leadImage ? (
            <div class="div_image_news div_image_zoom">
              <a>
                <img src={topic.leadImage} style="max-width:590px;height:auto" alt={topic.title} />
              </a>
            </div>
          ) : null}
        </div>
        <div style="font-size:1.3em;line-height:1.5">{topic.body}</div>
      </div>
      <table class="div_topic_bottom" cellpadding="0" cellspacing="0">
        <tr>
          <td class="div_topic_votes_buttons">
            <a class="blue a_nobackground" style="padding:5px 10px" onclick="return false" href="#">
              +
            </a>
            <a class="blue a_nobackground" style="padding:5px 10px" onclick="return false" href="#">
              −
            </a>
          </td>
          <td style="width:200px">
            <VoteBar up={topic.votesUp} down={topic.votesDown} />
          </td>
          <td>
            <div class="a_trashcut">
              <a href="#div_comments_0">
                {topic.commentCount > 0 ? replyCountText(topic.commentCount) : "Обсудить"}
              </a>
            </div>
          </td>
        </tr>
      </table>
      <div class="div_social3" id={`div_social3_${topic.id}`}> </div>
      <div class="div_bookmarks" id={`div_bookmarks_${topic.id}`}> </div>
    </div>
  );
};