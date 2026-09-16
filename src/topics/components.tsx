import type { FC } from "hono/jsx";
import { formatDate, replyCountText, voteBarWidths, htmlExcerpt, firstImageSrc, stripTags } from "../core/utils";
import type { TopicListItem, TopicDetail, LeaderboardEntry } from "./service";

export function topicUrl(t: TopicListItem | TopicDetail): string {
  return `/topics/${t.id}/${t.slug}`;
}

export function avatarSrc(url: string | null): string {
  return url ?? "/images/default_avatar.png";
}

function cardImage(topic: TopicListItem): string | null {
  return topic.leadImage ?? firstImageSrc(topic.body);
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

export const VoteBar: FC<{ id: number; up: number; down: number; total?: number }> = ({
  id,
  up,
  down,
  total = 120,
}) => {
  const { upPx, downPx } = voteBarWidths(up, down, total);
  const score = up - down;
  return (
    <div id={`div_vote_0_${id}`} class="div_votes_control">
      <noindex>
        <table cellpadding="0" cellspacing="0" style="width:auto">
          <tbody>
            <tr>
              <td style="width:1%">
                <div class="div_topic_votes_current">
                  <nobr>{score > 0 ? `+${score}` : String(score)}</nobr>
                </div>
              </td>
              <td style="width:1%">
                <div class="div_topic_votes_advanced">
                  <nobr>{up} понравилось</nobr>
                  <table cellpadding="0" cellspacing="0" class="div_topic_votes_bar">
                    <tbody>
                      <tr>
                        <td style={`background:#1FB6F2;width:${upPx}px`}> </td>
                        <td style={`background:#999999;width:${downPx}px`}> </td>
                      </tr>
                    </tbody>
                  </table>
                  <nobr>{down} не понравилось</nobr>
                </div>
              </td>
              <td style="width:1%">
                <table cellpadding="0" cellspacing="0" class="div_topic_votes_buttons">
                  <tbody>
                    <tr>
                      <td style="background:#1FB6F2;padding:0px 5px">+</td>
                    </tr>
                    <tr>
                      <td style="background:#999999;padding:0px 5px">–</td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td>
                <div class="div_topic_votes_join" id={`div_votes_like_${id}`}> </div>
              </td>
              <td> </td>
            </tr>
          </tbody>
        </table>
      </noindex>
    </div>
  );
};

export const DiscussButton: FC<{ count: number; href: string }> = ({ count, href }) => (
  <a href={href} class="blue div_topic_discuss">
    <div class="div_table2 right">
      <div class="div_row">
        <div class="div_cell div_topic_discuss_count blue">{count}</div>
        <div class="div_cell div_topic_discuss_go blue">
          {count > 0 ? "Обсудить" : "Обсудить"}&nbsp;→
        </div>
      </div>
    </div>
  </a>
);

export const TopicCard: FC<{ topic: TopicListItem }> = ({ topic }) => (
  <div class="div_topic" id={`div_topic_${topic.id}`}>
    <table cellpadding="0" cellspacing="0">
      <tr>
        <td class="td1">
          <a href={`/users/${topic.authorUsername}/`}>
            <Avatar src={topic.authorAvatar} size="48px" />
          </a>
        </td>
        <td class="td2">
          <div>
            <span class="span_link">
              <a rel="nofollow" href={`/users/${topic.authorUsername}/`}>
                {topic.authorUsername}
              </a>
              <span class="dark">, {formatDate(topic.createdAt)}</span>
            </span>
          </div>
          <h2 class="h_topic_caption">
            <a href={topicUrl(topic)} class="black">
              {topic.title}
            </a>
          </h2>
          <div class="div_topic_caption_tags">
            {topic.tags.length > 0 ? (
              <>
                {topic.tags.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 ? ", " : ""}
                    <a href={`/public/${topic.categorySlug}/tags/${t.slug}/`}>
                      {t.name}
                    </a>
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </td>
      </tr>
    </table>
    <div class="div_text">
      <div class="div_full_screens">
        {cardImage(topic) ? (
          <div class="div_image_news">
            <a href={topicUrl(topic)} rel="nofollow">
              <img
                src={cardImage(topic)!}
                style="max-width:380px;height:auto"
                alt={topic.title}
                title={topic.title}
              />
            </a>
          </div>
        ) : null}
      </div>
      <div dangerouslySetInnerHTML={{ __html: htmlExcerpt(topic.body, 220) }} />
      {stripTags(topic.body).length > 220 ? (
        <a href={topicUrl(topic)} class="dark2" style="font-size:1.2em">
          Читать дальше →
        </a>
      ) : null}
      <br class="clear" />
    </div>
    <div class="div_social3" id={`div_social3_${topic.id}`}> </div>
    <table cellpadding="0" cellspacing="0" class="div_topic_bottom">
      <tr>
        <td>
          <VoteBar id={topic.id} up={topic.votesUp} down={topic.votesDown} />
        </td>
        <td style="vertical-align:middle;width:1%">
          <DiscussButton
            count={topic.commentCount}
            href={`${topicUrl(topic)}#comments`}
          />
        </td>
      </tr>
    </table>
    <div class="div_bookmarks" id={`div_bookmarks_${topic.id}`}> </div>
    <br class="clear" />
  </div>
);

export const FeaturedCarousel: FC<{ items: TopicListItem[] }> = ({ items }) => (
  <noindex>
    <div class="div_table clear adh2" id="div_top_news_block">
      <div class="div_row">
        <div id="div_top_news_caption" class="white">
          Интересное
        </div>
        {items.map((t) => {
          const img = cardImage(t);
          return (
            <div class="div_cell div_top_news_b1" key={t.id}>
              <a
                class="div_top_news_b2"
                href={topicUrl(t)}
                style={
                  img
                    ? `background: url(${img}) no-repeat center center; background-size: cover;`
                    : `background: #e7e7e7 no-repeat center center;`
                }
              >
                <div class="div_top_news_text" align="center">
                  <span>{t.title}</span>
                </div>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  </noindex>
);

export const Leaderboard: FC<{
  authors: LeaderboardEntry[];
  commenters: LeaderboardEntry[];
}> = ({ authors, commenters }) => (
  <noindex>
    <div class="div_block">
      <div class="div_table">
        <div class="div_row">
          <div class="div_cell ad3">
            <h3 class="h_index">Лучшие авторы за неделю:</h3>
            {authors.length === 0 ? (
              <div class="dark" style="padding:5px">Пока нет данных</div>
            ) : (
              <table cellpadding="0" cellspacing="0">
                <tbody>
                  {authors.map((u) => (
                    <tr key={u.id}>
                      <td style="vertical-align:middle;text-align:right">
                        <h2>
                          <span class="dark">{u.score}</span>
                        </h2>
                      </td>
                      <td style="vertical-align:middle;height:24px;padding:4px">
                        <img src={avatarSrc(u.avatar)} style="max-width:24px" alt="" />
                      </td>
                      <td style="vertical-align:middle">
                        <h3>
                          <a href={u.url}>{u.username}</a>
                        </h3>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div class="div_cell ad3">
            <h3 class="h_index">Лучшие комментаторы за неделю:</h3>
            {commenters.length === 0 ? (
              <div class="dark" style="padding:5px">Пока нет данных</div>
            ) : (
              <table cellpadding="0" cellspacing="0">
                <tbody>
                  {commenters.map((u) => (
                    <tr key={u.id}>
                      <td style="vertical-align:middle;text-align:right">
                        <h2>
                          <span class="dark">{u.score}</span>
                        </h2>
                      </td>
                      <td style="vertical-align:middle;height:24px;padding:4px">
                        <img src={avatarSrc(u.avatar)} style="max-width:24px" alt="" />
                      </td>
                      <td style="vertical-align:middle">
                        <h3>
                          <a href={u.url}>{u.username}</a>
                        </h3>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  </noindex>
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
          <a href={`/users/${topic.authorUsername}/`}>{topic.authorUsername}</a>
        </>)
      : null}
      {arrow ? " →" : ""}
    </span>
  </div>
);

export const TopicDetailView: FC<{ topic: TopicDetail; canDelete?: boolean }> = ({
  topic,
  canDelete = false,
}) => {
  const isForum = topic.categoryType === "forum";
  return (
    <div class="div_topic" id={`div_topic_${topic.id}`}>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td class="td1">
            <a href={`/users/${topic.authorUsername}/`}>
              <Avatar src={topic.authorAvatar} size="48px" />
            </a>
          </td>
          <td class="td2">
            <div>
              <span class="span_link">
                <a rel="nofollow" href={`/users/${topic.authorUsername}/`}>
                  {topic.authorUsername}
                </a>
                <span class="dark">, {formatDate(topic.createdAt)}</span>
              </span>
            </div>
            <h1 class="h_topic_caption">
              <a href={topicUrl(topic)} class="black">
                {topic.title}
              </a>
            </h1>
            <div class="div_topic_caption_tags">
              {topic.tags.map((t, i) => (
                <span key={t.id}>
                  {i > 0 ? ", " : ""}
                  <a href={`/public/${topic.categorySlug}/tags/${t.slug}/`}>{t.name}</a>
                </span>
              ))}
            </div>
          </td>
        </tr>
      </table>
      <div class="div_text">
<div class="div_full_screens">
        {topic.leadImage && firstImageSrc(topic.body) !== topic.leadImage ? (
          <div class="div_image_news div_image_zoom">
            <a>
              <img src={topic.leadImage} style="max-width:590px;height:auto" alt={topic.title} />
            </a>
          </div>
        ) : null}
      </div>
        <div dangerouslySetInnerHTML={{ __html: topic.body }} />
      </div>
      <div class="div_social3" id={`div_social3_${topic.id}`}> </div>
      <table cellpadding="0" cellspacing="0" class="div_topic_bottom">
        <tr>
          <td>
            <VoteBar id={topic.id} up={topic.votesUp} down={topic.votesDown} />
          </td>
          <td style="vertical-align:middle;width:1%">
            <DiscussButton count={topic.commentCount} href="#div_comments_0" />
          </td>
        </tr>
      </table>
      <div class="div_bookmarks" id={`div_bookmarks_${topic.id}`}> </div>
      {canDelete ? (
        <form
          method="post"
          action={`/topics/${topic.id}/delete/`}
          style="margin-top:10px"
          onsubmit="return confirm('Удалить топик?')"
        >
          <button type="submit" class="a_dashed" style="border:0;background:none;cursor:pointer">
            Удалить топик
          </button>
        </form>
      ) : null}
    </div>
  );
};