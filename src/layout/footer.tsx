import type { FC } from "hono/jsx";
import { config } from "../core/config";

export const Footer: FC = () => {
  const year = new Date().getFullYear();
  return (
    <div class="div_bottom_block">
      <div class="div_layout">
        <div class="div_table ad2">
          <div class="div_row ad2">
            <div class="div_cell ad2">
              <div id="div_copyright_simple" class="white">
                <div class="div_table ad1" style="width:auto">
                  <div class="div_row ad1">
                    <div class="div_cell ad1">
                      <noindex>
                        <span style="font-size:14px">©</span>&nbsp;{config.copyrightStart}-{year}&nbsp;
                        <a href="/" rel="nofollow">{config.copyrightOwner}</a>
                        <br />
                        <a href="/rules/" rel="nofollow">Правила сайта</a>
                        <br />
                      </noindex>
                      <a href="/">
                        <b>Мобильная версия</b>
                      </a>
                    </div>
                    <div class="div_cell ad1">
                      <noindex>
                        <a href="/thanks/" rel="nofollow">Благодарности</a>
                        <br />
                        <a href="/copyright/" rel="nofollow">Правообладателям</a>
                      </noindex>
                    </div>
                    <div class="div_cell ad1">
                      <a href="/advertising/" rel="nofollow">
                        Реклама, обзоры<br />и сотрудничество (pdf)
                      </a>
                      <br />
                    </div>
                  </div>
                </div>
                <div class="adh0 adhs2">
                  <a
                    href="#"
                    onclick="disable_adaptive(0); return false;"
                    rel="nofollow"
                    class="div_bottom_button"
                  >
                    <b>Отключить адаптацию под&nbsp;устройство</b>
                  </a>
                  <br />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};