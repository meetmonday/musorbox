import type { FC } from "hono/jsx";
import type { UserProfile, RatingInfo } from "./service";
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
          <td style="line-height:100%;font-size:48px;text-align:right;padding:0px 5px 5px 0px;">
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
  <div class="td_rank_pos">
    <div style="color:#999999;padding-bottom:5px">{label}</div>
    <table
      width="100%"
      style={`margin-bottom:5px;background-size:${pct}% 100%;height:25px;color:white;font-size:18px;line-height:18px;vertical-align:middle;background-color:#C0C0C0;background-image:url('/img/blank-blue.png');background-repeat:no-repeat`}
    >
      <tbody>
        <tr>
          <td>{value > 0 ? value : ""}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
    <div style="text-align:right;color:#999999">
      макс.{" "}
      {maxUsername ? <a href={`/users/${maxUsername}/`}>{max}</a> : max}
    </div>
  </div>
);

const InfoField: FC<{
  label: string;
  value: string | null;
  href?: string;
  isOwner: boolean;
  name?: string;
}> = ({ label, value, href, isOwner, name }) =>
  isOwner ? (
    <tr>
      <td align="right" style="color:#777777;padding-right:10px">
        {label}
      </td>
      <td>
        <input
          type="text"
          name={name}
          size={30}
          value={value ?? ""}
          style="border:1px solid #cccccc;padding:2px 4px"
        />
      </td>
    </tr>
  ) : value ? (
    <tr>
      <td align="right" style="color:#777777;padding-right:10px">
        {label}
      </td>
      <td>
        {href ? (
          <a href={href} rel="nofollow">
            {value}
          </a>
        ) : (
          value
        )}
      </td>
    </tr>
  ) : null;

export const ProfilePage: FC<{
  profile: UserProfile;
  rating: RatingInfo | null;
  isOwner: boolean;
  following?: FollowingUiItem[];
  remoteProfileUrl?: string | null;
}> = ({ profile, rating, isOwner, following = [], remoteProfileUrl = null }) => {
  const name = profile.fullName || profile.username;
  const handle = profile.handle ?? profile.username;
  const registerAt = formatDateDots(profile.createdAt);
  const lastSeen = profile.lastSeenAt ? formatDateDots(profile.lastSeenAt) : registerAt;
  const topicsText = `${profile.topicsCount} ${pluralize(profile.topicsCount, "топик", "топика", "топиков")}`;
  const discussedText = `${profile.discussedTopics} ${pluralize(
    profile.discussedTopics,
    "топик",
    "топика",
    "топиков",
  )}`;

  return (
    <div>
      <form
        method="post"
        id="frm_profile"
        class="text12"
        action={`/users/${profile.username}/`}
      >
      <input type="hidden" name="edit_profile" value="1" />
      <div style="margin-right:40px">
        <table style="margin-bottom:10px">
          <tbody>
            <tr>
              <td style="padding-right:20px">
                <table cellpadding="0" cellspacing="0">
                  <tbody>
                    <tr>
                      <td>
                        <img
                          style="margin-right:10px;width:90px;height:90px"
                          src={avatarSrc(profile.avatarUrl)}
                          class="left"
                          alt=""
                        />
                      </td>
                      <td>
                        {isOwner ? (
                          <input
                            type="text"
                            name="full_name"
                            value={name}
                            style="font-size:1.9em;font-weight:bold;border:1px solid #cccccc;padding:2px 6px"
                          />
                        ) : (
                          <h1>{name}</h1>
                        )}
                        <div style="color:#999999;font-size:10px;padding-top:10px">
                          {roleTitle(profile.role)}
                          <br />
                          <nobr>Зарегистрирован: {registerAt}</nobr>
                          <br />
                          <nobr>Был на сайте: {lastSeen}</nobr>
                          <br />
                          <b>Обсуждаемых топиков: {discussedText}</b>
                          <br />
                        </div>
                        <br />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td>
                <div
                  style="float:left;border:5px solid #f0f0f0;padding:5px 10px;font-size:14px"
                >
                  <div style="padding:2px 0px">
                    <a href={`/user_topics/${profile.username}/`}>
                      Все топики {handle}
                    </a>{" "}
                    [{topicsText}]
                  </div>
                </div>
                <br class="clear" />
              </td>
            </tr>
            <tr>
              <td>
                <style>{`.td_rank_pos{padding:0px 10px 5px 0px;width:165px;}`}</style>
                <table>
                  <tbody>
                    {rating ? (
                      <>
                        <tr>
                          <td class="td_rank_pos">
                            <RankBox
                              title={
                                <>
                                  место в рейтинге
                                  <br />
                                  конкурса
                                </>
                              }
                              sortHref="/public/users/"
                              votes={rating.contestVotes}
                              place={rating.contestPlace}
                            />
                          </td>
                          <td class="td_rank_pos">
                            <RankBox
                              title={
                                <>
                                  место в общем
                                  <br />
                                  рейтинге
                                </>
                              }
                              sortHref="/public/users/?sort=rank_all"
                              votes={rating.overallVotes}
                              place={rating.overallPlace}
                            />
                          </td>
                        </tr>
                        <tr>
                          <RatingBar
                            label="рейтинг конкурса"
                            value={rating.contestValue}
                            pct={rating.contestPct}
                            max={rating.contestMax}
                            maxUsername={rating.contestMaxUsername}
                          />
                          <RatingBar
                            label="общий рейтинг"
                            value={rating.overallValue}
                            pct={rating.overallPct}
                            max={rating.overallMax}
                            maxUsername={rating.overallMaxUsername}
                          />
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr>
                          <td class="td_rank_pos">
                            <div style="background-color:#ff4d4d" class="white">
                              <div style="padding:5px 10px">
                                {handle} не участвует в рейтинге
                              </div>
                              <table width="100%">
                                <tbody>
                                  <tr>
                                    <td style="vertical-align:middle;font-size:10px;padding:0px 10px 5px 10px;opacity:0.5"></td>
                                    <td style="line-height:100%;font-size:48px;text-align:right;padding:0px 5px 5px 0px">
                                      <span style="position:relative;top:-5px;right:5px">
                                        <a href="/public/users/" style="text-decoration:none"></a>
                                      </span>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </td>
                          <td class="td_rank_pos"></td>
                        </tr>
                        <tr></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </td>
              <td style="padding-top:10px">
                <table>
                  <tbody>
                    <InfoField
                      label="Страна"
                      value={profile.country}
                      isOwner={isOwner}
                      name="country"
                    />
                    <InfoField
                      label="Город"
                      value={profile.city}
                      isOwner={isOwner}
                      name="city"
                    />
                    <tr>
                      <td>
                        <br />
                      </td>
                    </tr>
                    <InfoField
                      label="ВК"
                      value={profile.vkUrl}
                      href={
                        profile.vkUrl
                          ? profile.vkUrl.startsWith("http")
                            ? profile.vkUrl
                            : `http://vk.com/${profile.vkUrl}`
                          : undefined
                      }
                      isOwner={isOwner}
                      name="vk"
                    />
                    <InfoField
                      label="Twitter"
                      value={profile.twitterUrl}
                      href={
                        profile.twitterUrl
                          ? profile.twitterUrl.startsWith("http")
                            ? profile.twitterUrl
                            : `http://twitter.com/${profile.twitterUrl}`
                          : undefined
                      }
                      isOwner={isOwner}
                      name="twitter"
                    />
                    <InfoField label="Skype" value={profile.skype} isOwner={isOwner} name="skype" />
                    <InfoField
                      label="Устройства"
                      value={profile.devices}
                      isOwner={isOwner}
                      name="devices"
                    />
                    <tr>
                      <td>
                        <br />
                      </td>
                    </tr>
                    {isOwner ? (
                      <tr>
                        <td></td>
                        <td>
                          <button
                            type="submit"
                            class="blue"
                            style="padding:5px 15px;border:0;cursor:pointer"
                          >
                            Сохранить профиль
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      </form>
      {isOwner ? <FediversePanel username={profile.username} following={following} /> : null}
      {remoteProfileUrl ? (
        <div class="dark" style="margin-top:15px;padding:10px;font-size:1.2em">
          <b>Внешний профиль (ActivityPub):</b>{" "}
          <a href={remoteProfileUrl} rel="nofollow">
            {remoteProfileUrl}
          </a>
        </div>
      ) : null}
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