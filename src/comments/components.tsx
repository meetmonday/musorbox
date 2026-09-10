import type { FC } from "hono/jsx";
import type { TopicComment } from "./service";
import { formatDate } from "../core/utils";

export const CommentItem: FC<{ comment: TopicComment }> = ({ comment }) => (
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
    <div class="right">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="background: #999999; padding: 0px 5px; color:#fff">–</td>
          <td>
            <div class="div_comment_votes_current div_vote_zero">{comment.votesUp - comment.votesDown}</div>
          </td>
          <td style="background: #1FB6F2; padding: 0px 5px; color:#fff">+</td>
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
    </div>
  </div>
);

export const CommentList: FC<{ comments: TopicComment[] }> = ({ comments }) => (
  <div>
    {comments.map((c) => (
      <CommentItem key={c.id} comment={c} />
    ))}
  </div>
);

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