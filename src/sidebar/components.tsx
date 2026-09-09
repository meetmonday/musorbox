import type { FC } from "hono/jsx";
import type { TopicListItem } from "../topics/service";
import { TopicMini, Avatar, topicUrl } from "../topics/components";

export const RecentDiscussions: FC<{
  items: TopicListItem[];
}> = ({ items }) => (
  <div class="div_panel_view_block">
    <div class="div_panel_caption">Свежие обсуждения</div>
    <div class="div_panel_view">
      {items.map((t) => (
        <div class="div_topic_min" key={t.id}>
          <Avatar src={t.authorAvatar} size="24px" className="img_topic_min_avatar" />
          <a href={topicUrl(t)}>{t.title}</a>
          <span class="dark"> [{t.commentCount}] </span>
          <br />
          <span class="div_topic_min_author">
            <a href={`/users/${t.authorUsername}`}>{t.authorUsername}</a>
          </span>
        </div>
      ))}
      <div class="div_panel_link">
        <a href="/public/all_topics/" class="dark2">
          Еще комментарии →
        </a>
      </div>
    </div>
  </div>
);

export const NewOnSite: FC<{ items: TopicListItem[] }> = ({ items }) => (
  <div class="div_panel_view_block">
    <div class="div_panel_caption">
      Новое на сайте <a href="/feed_topics/1/" class="a_social_bottom" title="RSS">
        <img src="/images/rss.png" style="width:20px;height:20px;float:right" alt="RSS" />
      </a>
    </div>
    <div class="div_panel_view">
      {items.map((t) => (
        <div class="div_topic_min" key={t.id}>
          <Avatar src={t.authorAvatar} size="24px" className="img_topic_min_avatar" />
          <a href={topicUrl(t)}>{t.title}</a>
          <span class="dark">
            {t.commentCount > 0 ? ` [${t.commentCount}] ` : " "}
            <a href={`/users/${t.authorUsername}`}>{t.authorUsername}</a>
          </span>
        </div>
      ))}
      <div class="div_panel_link">
        <a href="/public/all_topics/" class="dark2">
          Еще топики →
        </a>
      </div>
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
  <div class="div_panel_view_block" style="text-align:center;margin:15px 0">
    <div class="div_panel_view" style="background:white;padding:10px;font-size:11px;color:#999">
      Реклама
      <div style="height:400px;background:#f1f1f1;margin-top:5px;display:flex;align-items:center;justify-content:center">
        240x400
      </div>
    </div>
  </div>
);