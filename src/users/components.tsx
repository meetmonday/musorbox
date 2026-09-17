import type { FC } from "hono/jsx";
import type { UserProfile, RatingInfo, ProfileInput } from "./service";
import type { FollowingUiItem } from "../activitypub/service";
import { formatDateDots, pluralize } from "../core/utils";
import { avatarSrc } from "../topics/components";

export function roleTitle(role: string): string {
  switch (role) {
    case "admin":
      return "Администратор";
    case "editor":
      return "Главный редактор";
    case "author":
      return "Автор";
    default:
      return "Уважаемый пользователь";
  }
}

const RankBox: FC<{
  title: unknown;
  sortHref: string;
  votes: number;
  place: number | null;
}> = ({ title, sortHref, votes, place }) => (
  <div style="background-color:#ff4d4d" class="white">
    <div style="padding: 5px 10px;">
      {title}
    </div>
    <table width="100%">
      <tbody>
        <tr>
          <td style="vertical-align:middle;font-size:10px;padding:0px 10px 5px 10px;opacity:0.5">
            {votes}&nbsp;
            {pluralize(votes, "голос", "голоса", "голосов")}
          </td>
          <td style="line-height:100%;font-size:48px;text-align:right;padding:0px">
            <span style="position:relative;top:-5px;right:5px">
              <a href={sortHref} style="text-decoration:none">
                {place ?? "—"}
              </a>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);

const RatingBar: FC<{
  label: string;
  value: number;
  pct: number;
  max: number;
  maxUsername: string | null;
}> = ({ label, value, pct, max, maxUsername }) => (
  <td class="td_rank_pos">
    <div style="color:#999999;padding-bottom:5px">{label}</div>
    <table width="100%" style={`margin-bottom:5px;background-size:${pct}% 100%;height:25px;color:white;font-size:18px;line-height:18px;vertical-align:middle;background-color:#C0C0C0;background-image:url('/img/blank-blue.png');background-repeat:no-repeat`}>
      <tbody><tr><td>{value}</td><td></td></tr></tbody>
    </table>
    <div style="text-align:right;color:#999999">макс. {maxUsername ? <a href={`/users/${maxUsername}`}>{max}</a> : max}</div>
  </td>
);

const InfoField: FC<{
  label: string;
  value: string | null;
  href?: string;
}> = ({ label, value, href }) => value ? (
  <tr>
    <td align="right" style="color:#777777;padding-right:10px">{label}</td>
    <td>{href ? <a href={href} rel="nofollow">{value}</a> : value}</td>
  </tr>
) : null;

export const SettingsPage: FC<{
  profile: UserProfile;
  values?: ProfileInput;
  error?: string;
  saved?: boolean;
}> = ({ profile, values, error, saved }) => {
  const fields = [
    ["fullName", "full_name", "Полное имя", 100],
    ["country", "country", "Страна", 100],
    ["city", "city", "Город", 100],
    ["vkUrl", "vk", "ВК", 500],
    ["twitterUrl", "twitter", "Twitter", 500],
    ["skype", "skype", "Skype", 100],
    ["devices", "devices", "Устройства", 1000],
  ] as const;
  const action = `/users/${profile.username}/settings`;
  return (
    <div class="text12" id="user_settings">
      <style>{`
        #user_settings .div_auth_table { width:100%; table-layout:fixed; }
        #user_settings .div_auth_table td { overflow-wrap:anywhere; }
        #user_settings .div_auth_table td:first-child { width:160px; }
        #user_settings .input_auth { box-sizing:border-box; width:320px; max-width:100%; }
        @media (max-width:600px) {
          #user_settings .div_auth_table,
          #user_settings .div_auth_table tbody,
          #user_settings .div_auth_table tr,
          #user_settings .div_auth_table td { display:block; width:auto; }
          #user_settings .div_auth_table td:first-child { width:auto; }
          #user_settings .div_auth_table td:empty { display:none; }
          #user_settings .div_auth_table tr { margin-bottom:8px; }
          #user_settings .auth_label { text-align:left; }
          #user_settings .input_auth { width:100%; }
        }
      `}</style>
      <h1 class="h_page_header">Настройки профиля</h1>
      <p><a href={`/users/${profile.username}/`}>Вернуться в профиль</a></p>
      <p><a href="/settings/api">Токен для публичного API</a></p>
      {error ? <div style="color:#EE0000;margin-bottom:10px" role="alert">{error}</div> : null}
      {saved ? <div class="div_block" role="status">Профиль сохранён.</div> : null}
      <div class="div_block">
        <h2>Личные данные</h2>
        <form method="post" action={action} enctype="multipart/form-data" id="frm_settings_profile">
          <input type="hidden" name="action" value="profile" />
          <table class="div_auth_table"><tbody>
            {fields.map(([key, name, label, limit]) => (
              <tr key={name}>
                <td class="auth_label"><label for={`settings_${name}`}>{label}:</label></td>
                <td><input id={`settings_${name}`} class="input_auth" type="text" name={name} maxlength={limit} value={(values ?? profile)[key] ?? ""} /></td>
              </tr>
            ))}
            <tr><td class="auth_label">Аватар:</td><td><img class="avatar" src={avatarSrc(profile.avatarUrl)} alt="Текущий аватар" width="128" height="128" style="object-fit:cover" /></td></tr>
            <tr><td class="auth_label"><label for="settings_avatar">Загрузить аватар:</label></td><td><input id="settings_avatar" class="input_auth" type="file" name="avatar" accept="image/jpeg,image/png,image/gif,image/webp" /></td></tr>
            <tr><td /><td class="dark">JPG, PNG, GIF или WebP, до 8 МБ. Аватар будет обрезан до квадрата 128×128. Для анимации используется первый кадр. Выбранный файл заменит адрес ниже.</td></tr>
            <tr><td class="auth_label"><label for="settings_avatar_url">Или адрес аватара:</label></td><td><input id="settings_avatar_url" class="input_auth" type="text" name="avatar_url" maxlength={2000} value={(values ?? profile).avatarUrl ?? ""} /></td></tr>
            <tr><td /><td class="dark">Адрес изображения по HTTP/HTTPS или путь на сайте. Пустое поле — аватар по умолчанию.</td></tr>
            <tr><td /><td><label><input type="checkbox" name="rating_optout" value="1" checked={(values ?? profile).ratingOptout} /> Не участвовать в рейтинге</label></td></tr>
            <tr><td /><td><button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">Сохранить профиль</button></td></tr>
          </tbody></table>
        </form>
      </div>
      <div class="div_block">
        <h2>Смена пароля</h2>
        <form method="post" action={action} id="frm_settings_password">
          <input type="hidden" name="action" value="password" />
          <table class="div_auth_table"><tbody>
            <tr><td class="auth_label"><label for="current_password">Текущий пароль:</label></td><td><input id="current_password" class="input_auth" type="password" name="current_password" autocomplete="current-password" required /></td></tr>
            <tr><td class="auth_label"><label for="new_password">Новый пароль:</label></td><td><input id="new_password" class="input_auth" type="password" name="new_password" autocomplete="new-password" required /></td></tr>
            <tr><td class="auth_label"><label for="repeat_password">Повторите пароль:</label></td><td><input id="repeat_password" class="input_auth" type="password" name="repeat_password" autocomplete="new-password" required /></td></tr>
            <tr><td /><td class="dark">После смены пароля потребуется войти снова на всех устройствах.</td></tr>
            <tr><td /><td><button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">Изменить пароль</button></td></tr>
          </tbody></table>
        </form>
      </div>
    </div>
  );
};

export const ProfilePage: FC<{
  profile: UserProfile;
  rating: RatingInfo | null;
  isOwner: boolean;
  following?: FollowingUiItem[];
}> = ({ profile, rating, isOwner, following = [] }) => {
  const handle = profile.username;
  const hasContacts = !!(profile.country || profile.city || profile.vkUrl || profile.twitterUrl || profile.skype || profile.devices);
  return (
    <div>
      <div id="frm_profile" class="text12">
        <div style="margin-right:40px">
          <table style="margin-bottom:10px"><tbody>
            <tr>
              <td style="padding-right:20px">
                <table cellpadding="0" cellspacing="0"><tbody><tr>
                  <td><img style="margin-right:10px" src={avatarSrc(profile.avatarUrl)} class="left" alt="" /></td>
                  <td>
                    <h1>{profile.fullName || handle}</h1>
                    <div style="color:#999999;font-size:10px;padding-top:10px">
                      {roleTitle(profile.role)}<br />
                      {profile.createdAt ? <><nobr>Зарегистрирован: {formatDateDots(profile.createdAt)}</nobr><br /></> : null}
                      {profile.lastSeenAt ? <><nobr>Был на сайте: {formatDateDots(profile.lastSeenAt)}</nobr><br /></> : null}
                      <b>Обсуждаемых топиков: {profile.discussedTopics}</b><br />
                    </div><br />
                  </td>
                </tr></tbody></table>
              </td>
              <td>
                <div style="float:left;border:5px solid #f0f0f0;padding:5px 10px;font-size:14px">
                  <div style="padding:2px 0px"><a href={`/user_topics/${handle}/`}>Все топики {handle}</a> [{profile.topicsCount}]</div>
                </div><br class="clear" />
              </td>
            </tr>
            <tr>
              <td>
                <style>{`.td_rank_pos{padding:0px 10px 5px 0px;width:165px;}`}</style>
                <table><tbody>
                  {rating ? <>
                    <tr>
                      <td class="td_rank_pos"><RankBox title={<>место в рейтинге<br />конкурса</>} sortHref="/public/users/" votes={rating.contestVotes} place={rating.contestPlace} /></td>
                      <td class="td_rank_pos"><RankBox title={<>место в общем<br />рейтинге</>} sortHref="/public/users/?sort=rank_all" votes={rating.overallVotes} place={rating.overallPlace} /></td>
                    </tr>
                    <tr>
                      <RatingBar label="рейтинг конкурса" value={rating.contestValue} pct={rating.contestPct} max={rating.contestMax} maxUsername={rating.contestMaxUsername} />
                      <RatingBar label="общий рейтинг" value={rating.overallValue} pct={rating.overallPct} max={rating.overallMax} maxUsername={rating.overallMaxUsername} />
                    </tr>
                  </> : <>
                    <tr>
                      <td class="td_rank_pos">
                        <div style="background-color:#ff4d4d" class="white">
                          <div style="padding:5px 10px">{handle} не участвует в рейтинге</div>
                          <table width="100%"><tbody><tr>
                            <td style="vertical-align:middle;font-size:10px;padding:0px 10px 5px 10px;opacity:0.5"></td>
                            <td style="line-height:100%;font-size:48px;text-align:right;padding:0px"><span style="position:relative;top:-5px;right:5px"><a href="/public/users/" style="text-decoration:none"></a></span></td>
                          </tr></tbody></table>
                        </div>
                      </td>
                      <td class="td_rank_pos"></td>
                    </tr><tr></tr>
                  </>}
                </tbody></table>
              </td>
              <td style="padding-top:10px">
                <table>{hasContacts ? <tbody>
                  <InfoField label="Страна" value={profile.country} />
                  <InfoField label="Город" value={profile.city} />
                  <tr><td><br /></td></tr>
                  <InfoField label="ВК" value={profile.vkUrl} href={profile.vkUrl ? /^https?:\/\//i.test(profile.vkUrl) ? profile.vkUrl : `http://vk.com/${profile.vkUrl}` : undefined} />
                  <InfoField label="Twitter" value={profile.twitterUrl} href={profile.twitterUrl ? /^https?:\/\//i.test(profile.twitterUrl) ? profile.twitterUrl : `http://twitter.com/${profile.twitterUrl}/` : undefined} />
                  <InfoField label="Skype" value={profile.skype} />
                  <InfoField label="Устройства" value={profile.devices} />
                  <tr><td><br /></td></tr>
                </tbody> : null}</table>
              </td>
            </tr>
          </tbody></table>
        </div>
      </div>
      {isOwner ? <div class="text12"><a href={`/users/${handle}/settings`}>Настройки профиля</a></div> : null}
      {isOwner ? <FediversePanel username={handle} following={following} /> : null}
    </div>
  );
};

const FediversePanel: FC<{ username: string; following: FollowingUiItem[] }> = ({
  username,
  following,
}) => (
  <div class="dark" style="margin-top:15px;padding:10px;font-size:1.2em">
    <div style="padding-bottom:6px">
      <b>Подписки (ActivityPub)</b>
    </div>
    {following.length ? (
      <ul style="margin:0;padding-left:18px">
        {following.map((f) => (
          <li key={f.id} style="padding:2px 0">
            <a href={f.remoteId} rel="nofollow">
              {f.displayName ?? f.preferredUsername}
            </a>
            <span style="color:#999"> ({f.host})</span>
            {f.status === "requested" ? (
              <span style="color:#ffa500"> — ожидает подтверждения</span>
            ) : null}
            <form
              method="post"
              action={`/users/${username}/unfollow?actor_id=${f.id}`}
              style="display:inline;margin-left:8px"
            >
              <button type="submit" class="blue" style="padding:1px 8px;border:0;cursor:pointer">
                Отписаться
              </button>
            </form>
          </li>
        ))}
      </ul>
    ) : (
      <div style="color:#999">Пока ни на кого не подписаны.</div>
    )}
    <form method="post" action={`/users/${username}/follow`} style="margin-top:8px">
      <input
        type="text"
        name="target"
        placeholder="acct:user@host или https://домен/users/имя"
        size={40}
        style="border:1px solid #cccccc;padding:2px 4px;font-size:1.1em"
        required
      />
      <button type="submit" class="blue" style="padding:2px 12px;border:0;cursor:pointer">
        Подписаться
      </button>
    </form>
  </div>
);