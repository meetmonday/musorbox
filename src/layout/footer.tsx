import type { FC } from "hono/jsx";
import { config } from "../core/config";

export const Footer: FC = () => {
  const year = config.copyrightStart;
  return (
    <div class="div_bottom_block">
      <div class="div_layout">
        <div id="div_copyright_simple">
          <div class="div_table">
            <div class="div_row">
              <div class="div_cell">
                <a href="/">Trashbox.ru</a> — новости, программы и обзоры для мобильных устройств.
              </div>
              <div class="div_cell" style="text-align:right">
                <span class="dark">
                  © {year}-{new Date().getFullYear()} {config.copyrightOwner}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div id="div_copyright" style="clear:both">
          <span style="padding-right:20px">
            <a href="/rules/">Правила сайта</a>
          </span>
          <span style="padding-right:20px">
            <a href="http://m.trashbox.ru">Мобильная версия</a>
          </span>
          <span style="padding-right:20px">
            <a href="/thanks/">Благодарности</a>
          </span>
          <span style="padding-right:20px">
            <a href="/copyright/">Правообладателям</a>
          </span>
          <span style="padding-right:20px">
            <a href="/advertising/">Реклама</a>
          </span>
          <span style="float:right">
            <a href="/feed_topics/1/" class="a_social_bottom" title="RSS">
              <img src="/images/rss.png" alt="RSS" />
            </a>
            <a href="https://vk.com/trashbox_ru" class="a_social_bottom" title="Мы ВКонтакте">
              <img src="/images/icons_social6.png" alt="VK" style=""
                   onclick="return false;" />
            </a>
            <a href="https://twitter.com/trashbox_ru" class="a_social_bottom" title="Твиттер">
              <img src="/images/icons_social6.png" alt="TW" style="" />
            </a>
            <a href="https://www.facebook.com/" class="a_social_bottom" title="Facebook">
              <img src="/images/icons_social6.png" alt="FB" style="" />
            </a>
          </span>
        </div>
        <div class="div_server_stats">
          <a href="/" onclick="disable_adaptive(0); return false;" style="color:#999999;font-size:1.1em">
            Отключить адаптацию под устройство
          </a>
        </div>
      </div>
    </div>
  );
};