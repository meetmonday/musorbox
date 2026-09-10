import type { FC } from "hono/jsx";
import type { SidebarTopic } from "../topics/service";
import { topicUrl, avatarSrc } from "../topics/components";

export const SidebarTopicRow: FC<{
  topic: SidebarTopic;
  hot?: boolean;
  heat?: number;
}> = ({ topic, hot, heat }) => {
  const authorLine = hot ? (
    <a class="dark" rel="nofollow" href={`/users/${topic.authorUsername}/`}>
      {topic.authorUsername}
    </a>
  ) : topic.replier ? (
    <>
      <a class="dark" rel="nofollow" href={`/users/${topic.replier}/`}>
        {topic.replier}
      </a>
      {" → "}
      <a class="dark" rel="nofollow" href={`/users/${topic.replierSubject}/`}>
        {topic.replierSubject}
      </a>
    </>
  ) : (
    <a class="dark" rel="nofollow" href={`/users/${topic.authorUsername}/`}>
      {topic.authorUsername}
    </a>
  );

  return (
    <div
      class={`div_topic_min${hot ? " top" : ""}`}
      id={`div_topic_min_${topic.id}`}
      style={hot ? `background-size: ${heat ?? 100}% 100%` : undefined}
    >
      <table width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td class="img_topic_min_avatar comp">
            <img
              src={avatarSrc(!hot && topic.replier ? topic.replierAvatar : topic.authorAvatar)}
              style="max-width:24px"
              alt=""
            />
          </td>
          <td>
            <a href={topicUrl(topic)}>{topic.title}</a>{" "}
            <span class="dark2">{topic.commentCount}</span>
            <br />
            <div class="div_topic_min_author">{authorLine}</div>
          </td>
        </tr>
      </table>
    </div>
  );
};

export const HotTopics: FC<{ items: SidebarTopic[] }> = ({ items }) => {
  const max = Math.max(1, ...items.map((i) => i.commentCount));
  return (
    <div class="div_panel_view_block">
      <div class="div_panel_view top">
        <div class="div_panel_caption">Бурные обсуждения</div>
        {items.map((t) => (
          <SidebarTopicRow key={t.id} topic={t} hot heat={Math.round((t.commentCount / max) * 100)} />
        ))}
      </div>
    </div>
  );
};

export const RecentDiscussions: FC<{ items: SidebarTopic[] }> = ({ items }) => (
  <div class="div_panel_view_block clear">
    <div class="div_panel_view">
      <div class="div_panel_caption">Свежие обсуждения</div>
      {items.map((t) => (
        <SidebarTopicRow key={t.id} topic={t} />
      ))}
    </div>
  </div>
);

export const NewOnSite: FC<{ items: SidebarTopic[] }> = ({ items }) => (
  <div class="div_panel_view_block">
    <div class="div_panel_view">
      <div class="div_panel_caption">
        Новое на сайте
        <a href="/feed_topics/1/" style="background:none !important">
          <img src="/images/rss.png" style="position:relative;top:4px" alt="RSS" />
        </a>
      </div>
      {items.map((t) => (
        <SidebarTopicRow key={t.id} topic={t} />
      ))}
    </div>
  </div>
);

export const AdBanner: FC = () => (
  <div class="div_panel_view_block" style="text-align:center;margin:15px 0">
    <div class="div_panel_view" style="background:white;padding:10px;font-size:11px;color:#999">
      Реклама
      <div style="height:90px;background:#f1f1f1;margin-top:5px;display:flex;align-items:center;justify-content:center">
        728x90
      </div>
    </div>
  </div>
);

export const SidebarAd: FC = () => (
  <div style="text-align:center;margin:0 0 15px 0">
    <div class="div_panel_view" style="background:white;padding:10px;font-size:11px;color:#999;width:240px">
      Реклама
      <div style="height:400px;background:#f1f1f1;margin-top:5px;display:flex;align-items:center;justify-content:center">
        240x400
      </div>
    </div>
  </div>
);