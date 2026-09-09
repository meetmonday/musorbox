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
      <a href="/">
        <span id="img_top_logo"> </span>
        <span style="font-size:36px;font-weight:bold;color:black">Trashbox.ru</span>
      </a>
    </div>
    <h3 id="div_top_logo_header2">лучший мобильный портал</h3>
  </div>
);

export const SearchForm: FC = () => (
  <form action="/public/search/" method="get" id="frm_top_search">
    <input
      type="text"
      id="input_search1"
      name="string"
      value=""
      placeholder="поиск по сайту"
    />
    <img
      id="div_top_search_button"
      src="/images/loop_min.png"
      alt=""
      onclick="document.getElementById('frm_top_search').submit(); return false;"
      style="cursor:pointer;position:relative"
    />
  </form>
);

export const Header: FC<{ user: LayoutUser }> = ({ user }) => (
  <>
    <div class="div_top_user_menu">
      <div class="div_top_admin_menu_layout">
        <div class="div_table">
          <div class="div_row">
            <div class="div_cell" style="padding:5px 10px 5px 0px;font-size:1.3em">
              <div id="div_mymodel_block">
                <form method="post" id="form_select_model">
                  <input type="hidden" name="set_model" value="1" />
                  <span id="span_select_firm"> </span>
                </form>
              </div>
            </div>
            <div class="div_cell" id="div_auth_link">
              {user ? (
                <div class="right">
                  <a href="/users/{user.username}" class="a_userbar_button">
                    <img
                      src={user.avatarUrl ?? "/images/default_avatar.png"}
                      class="img_userbar_button"
                      style="width:32px;height:32px"
                      alt={user.username}
                    />
                  </a>
                  <a href="/logout" style="color:white;padding:5px 10px">({user.username})</a>
                </div>
              ) : (
                <div class="right">
                  <a
                    href="/login"
                    style="color:white;padding:5px 10px;text-decoration:underline"
                  >
                    Войти на сайт
                  </a>
                </div>
              )}
            </div>
            <div class="div_cell" id="div_top_search1">
              <SearchForm />
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
              <div class="div_top_menu_b1_1">
                <h3>
                  <a href="/public/b_news/" class="first">Новости</a>
                  <a href="/public/b_text/">Статьи</a>
                  <a href="/public/reviews/">Обзоры</a>
                  <a href="/public/progs/">Программы</a>
                  <a href="/public/games/">Игры</a>
                  <a href="/public/themes/">Темы</a>
                  <a href="/public/b_questions/">Форум</a>
                </h3>
              </div>
              <div class="div_top_menu_b1_2">
                <h3>
                  <a href="/public/circles/">Колонки</a>
                  <a href="/public/trashcast/">Трешкаст</a>
                  <a href="/public/users/">Конкурсы</a>
                  <a href="/public/help/">Помощь</a>
                  <a href="/public/offtop/">OFFTOP</a>
                </h3>
              </div>
              <div class="div_top_add_topic" style="float:right;text-align:right">
                <a href="/new_topic/" onclick="">
                  <span style="color:#1FB6F2;font-size:1.4em">+</span>
                  <span>Добавить топик</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="clear"> </div>
    </div>
  </>
);