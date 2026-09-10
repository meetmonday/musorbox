import type { FC } from "hono/jsx";

export type LayoutUser = {
  id: number;
  username: string;
  role: string;
  avatarUrl: string | null;
} | null;

export const LogoHeader: FC = () => (
  <div id="div_top_logo">
    <div id="div_top_logo_header">
      <nobr>
        <h2 id="div_top_logo_header1" class="h1">
          <a href="/" class="black">
            <img src="/images/blank.gif" id="img_top_logo" alt="" />
            <span>Trashbox.ru</span>
          </a>
        </h2>
        <h3 id="div_top_logo_header2">лучший мобильный портал</h3>
      </nobr>
    </div>
    <div id="div_top_search2" class="adh0 adhs2">
      <form
        onkeypress="if (event.keyCode==13) this.submit()"
        action="/public/search/"
        style="margin:0px;padding:0px"
        method="get"
      >
        <input type="text" name="string" id="input_search2" placeholder="поиск по сайту" />
        <br class="clear adh0 adhs1 adh2" />
        <input type="submit" value="→" />
      </form>
    </div>
    <br class="clear adh0 adh1 adhs2" />
  </div>
);

export const SearchForm: FC = () => (
  <form
    onkeypress="if (event.keyCode==13) this.submit()"
    action="/public/search/"
    style="margin:0px;padding:0px"
    method="get"
    id="frm_top_search"
  >
    <table cellpadding="0" cellspacing="0" align="right">
      <tbody>
        <tr>
          <td style="vertical-align:middle" class="adh2">
            <input type="text" id="input_search1" name="string" placeholder="поиск по сайту" />
          </td>
          <td style="vertical-align:middle" class="adh2">
            <input
              type="image"
              src="/images/loop_min.png"
              id="div_top_search_button"
              onclick="document.getElementById('frm_top_search').submit(); return false;"
              alt=""
            />
          </td>
        </tr>
      </tbody>
    </table>
  </form>
);

export const Header: FC<{ user: LayoutUser }> = ({ user }) => (
  <>
    <div class="div_top_user_menu white">
      <div class="div_top_admin_menu_layout">
        <div class="div_table ad3">
          <div class="div_row ad3">
            <div class="div_cell ad3" id="div_mymodel_block">
              <noindex>
                <div id="div_mymodel"></div>
                <div class="div_select_model">
                  <form method="post" id="form_select_model">
                    <input type="hidden" name="set_model" value="1" />
                    <span id="span_select_firm">
                      <select id="input_firm" name="firm_id">
                        <option value="0" selected>Выберите устройство</option>
                        <option value="5">HTC</option>
                        <option value="6">Samsung</option>
                        <option value="10">Nokia</option>
                        <option value="29">Apple</option>
                        <option value="55">LG</option>
                        <option value="48">Sony</option>
                        <option value="71">Google</option>
                      </select>
                    </span>
                  </form>
                </div>
              </noindex>
            </div>
            <div id="div_auth_link" class="div_cell white div_auth_orientation">
              <div id="div_user_d">
                <div class="div_table adl" style="position:relative;float:right;width:auto">
                  <div class="div_row adl">
                    <div class="div_cell adh0 adc2 adl" style="width:1%">
                      <img
                        src="/images/blank.gif"
                        class="img_userbar_top"
                        alt="Наверх"
                        title="Наверх"
                        onclick="window.scroll(0,0);return false;"
                      />
                    </div>
                    <div class="div_cell adh0 adc2 adl" style="width:1%">
                      <img
                        src="/images/blank.gif"
                        class="img_userbar_down"
                        alt="Вниз"
                        title="Вниз"
                        onclick="return false;"
                      />
                    </div>
                    <div class="div_cell adh1">
                      {user ? (
                        <a href={`/users/${user.username}`} class="a_userbar_button" title="Профиль">
                          <img
                            src={user.avatarUrl ?? "/images/default_avatar.png"}
                            class="img_userbar_button"
                            style="width:32px;height:32px"
                            alt={user.username}
                          />
                        </a>
                      ) : (
                        <noindex>
                          <h2 class="white">
                            <a href="/login" class="underline">
                              <nobr>Войти на сайт</nobr>
                            </a>
                          </h2>
                        </noindex>
                      )}
                    </div>
                    <div class="div_cell adh0 adhs1" id="div_profile_button">
                      <img
                        src="/images/blank.gif"
                        class="img_userbar_profile"
                        alt="Профиль"
                        title="Профиль"
                        onclick="return false;"
                      />
                    </div>
                    <div id="div_top_search1" class="div_cell adh2">
                      <SearchForm />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="div_layout">
      <div class="div_table">
        <div class="div_row">
          <div class="div_cell">
            <LogoHeader />
          </div>
          <div class="div_cell" id="div_menu_page">
            <div id="div_top_menu_simple">
              <div class="div_top_menu_b1_1 ad3">
                <div class="div_top_menu_b2">
                  <h3>
                    <a href="/public/progs/" class="first">Программы</a>
                  </h3>
                  <h3>
                    <a href="/public/games/">Игры</a>
                  </h3>
                  <h3>
                    <a href="/public/themes/">Темы</a>
                  </h3>
                </div>
                <div class="div_top_menu_b2">
                  <h3>
                    <a href="/public/b_news/" class="first">Новости</a>
                  </h3>
                  <h3>
                    <a href="/public/b_text/">Статьи</a>
                  </h3>
                  <h3>
                    <a href="/public/reviews/">Обзоры</a>
                  </h3>
                  <h3>
                    <a href="/public/b_questions/">Форум</a>
                  </h3>
                </div>
              </div>
              <div class="div_top_menu_b1_2 ad3">
                <div class="div_top_menu_b2">
                  <h3>
                    <a href="/public/users/" class="first">Конкурсы</a>
                  </h3>
                  <h3>
                    <a href="/public/trashcast/">Трешкаст</a>
                  </h3>
                </div>
                <div class="div_top_menu_b2">
                  <h3>
                    <a href="/public/help/" class="first">Помощь</a>
                  </h3>
                  <h3>
                    <a href="/public/circles/">Колонки</a>
                  </h3>
                  <h3>
                    <a href="/feed_topics/1/">RSS</a>
                  </h3>
                </div>
              </div>
              <noindex>
                <a href="/new_topic/" rel="nofollow" class="h_new_topic3 blue">
                  Добавить&nbsp;топик
                </a>
              </noindex>
            </div>
          </div>
        </div>
      </div>
      <div class="clear">
        {" "}
      </div>
    </div>
  </>
);