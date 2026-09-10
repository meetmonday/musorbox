import type { FC } from "hono/jsx";
import type { TopicComment } from "./service";
import { formatDate } from "../core/utils";

const CommentNode: FC<{
  comment: TopicComment;
  childrenComments: TopicComment[];
  childrenMap: Map<number, TopicComment[]>;
}> = ({ comment, childrenComments, childrenMap }) => (
  <div id={`div_comment_${comment.id}`} class="div_comment">
    <div class="div_avatar_small">
      {comment.authorAvatar ? (
        <img
          src={comment.authorAvatar}
          style="width:24px;height:24px"
          alt={comment.authorUsername}
        />
      ) : (
        <img src="/images/default_avatar.png" style="width:24px;height:24px" alt="" />
      )}
    </div>
    <div id={`div_vote_1_${comment.id}`} class="div_votes_control">
      <table class="div_votes_control" cellpadding="0" cellspacing="0">
        <tr>
          <td class="div_comment_votes_buttons">
            <table>
              <tr>
                <td style="background:#1FB6F2;padding:0px 5px">+</td>
              </tr>
              <tr>
                <td style="background:#999999;padding:0px 5px">–</td>
              </tr>
            </table>
          </td>
          <td class="right">
            <div class={`div_comment_votes_current${comment.votesUp - comment.votesDown === 0 ? " div_vote_zero" : ""}`}>
              <nobr>{comment.votesUp - comment.votesDown}</nobr>
            </div>
          </td>
        </tr>
      </table>
    </div>
    <div class="div_header">
      <a rel="nofollow" href={`/users/${comment.authorUsername}`}>
        {comment.authorUsername}
      </a>
      <span class="dark">, {formatDate(comment.createdAt)}</span>{" "}
      <a href={`#div_comment_${comment.id}`}>#</a>
    </div>
    <br class="clear" />
    <div class="div_content_comm" id={`div_content_comm_${comment.id}`}>
      <div class="div_text" style="font-size:1.25em">{comment.body}</div>
      <div id={`div_new_comment_${comment.id}`} class="div_new_comment clear">
        <a href={`/topics/${comment.topicId}/#div_new_comment_0`}>Ответить</a>
      </div>
      {childrenComments.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          childrenComments={childrenMap.get(c.id) ?? []}
          childrenMap={childrenMap}
        />
      ))}
    </div>
  </div>
);

export const CommentList: FC<{ comments: TopicComment[] }> = ({ comments }) => {
  const childrenMap = new Map<number, TopicComment[]>();
  for (const c of comments) {
    const key = c.parentId;
    if (key !== null) {
      const list = childrenMap.get(key) ?? [];
      list.push(c);
      childrenMap.set(key, list);
    }
  }
  const roots = comments.filter((c) => c.parentId === null);
  return (
    <div>
      {roots.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          childrenComments={childrenMap.get(c.id) ?? []}
          childrenMap={childrenMap}
        />
      ))}
    </div>
  );
};

export const CommentForm: FC<{ topicId: number; loggedIn: boolean }> = ({ topicId, loggedIn }) => (
  <div id="div_new_comment_0" class="div_new_comment clear">
    {loggedIn ? (
      <form method="post" action={`/topics/${topicId}/add_comment/`} id="frm_new_comment">
        <textarea
          name="body"
          rows={5}
          style="width:98%;font-size:1.3em;font-family:inherit"
          placeholder="Ваш комментарий..."
          required
        />
        <div style="margin-top:5px">
          <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
            Отправить
          </button>
        </div>
      </form>
    ) : (
      <a href="/login" class="a_dashed">
        Войдите, чтобы оставить комментарий
      </a>
    )}
  </div>
);