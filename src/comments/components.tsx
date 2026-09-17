import type { FC } from "hono/jsx";
import type { TopicComment } from "./service";
import { formatDate } from "../core/utils";

const CommentTop: FC<{ comment: TopicComment; showDelete?: boolean; showEdit?: boolean; showHide?: boolean }> = ({ comment, showDelete, showEdit, showHide }) => {
  const score = comment.votesUp - comment.votesDown;
  return (
    <>
      <div class="div_avatar_small">
        <img
          src={comment.authorAvatar ?? "/images/default_avatar.png"}
          style="width:24px;height:24px"
          alt=""
        />
      </div>
      <div class="right">
        <div id={`div_vote_1_${comment.id}`} class="div_votes_control">
          <table cellpadding="0" cellspacing="0">
            <tbody>
              <tr>
                <td class="div_comment_votes_buttons">
                  <table cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <td style="background:#999999;padding:0px 5px" data-vote="-1">–</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td>
                  <div class={`div_comment_votes_current${score === 0 ? " div_vote_zero" : ""}`}>
                    {score}
                  </div>
                </td>
                <td class="div_comment_votes_buttons">
                  <table cellpadding="0" cellspacing="0">
                    <tbody>
                      <tr>
                        <td style="background:#1FB6F2;padding:0px 5px" data-vote="1">+</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="div_header">
        <a rel="nofollow" href={comment.authorProfileUrl}>
          {comment.authorHandle}
        </a>
        <span class="dark">, {formatDate(comment.createdAt)}</span>{" "}
        <a href={`#div_comment_${comment.id}`}>#</a>
        {showEdit ? (
          <a
            href="#"
            title="Изменить комментарий"
            onclick={`show_edit_comment_form(${comment.id}); return false;`}
            style="margin-left:6px;color:#1FB6F2;text-decoration:none"
          >
            ✎
          </a>
        ) : null}
        {showHide ? (
          <form
            method="post"
            action={`/moderation/comments/${comment.id}/${comment.hidden ? "show" : "hide"}/`}
            style="display:inline"
            onsubmit="var r = prompt('Причина:'); if (r === null) return false; this.reason.value = r;"
          >
            <input type="hidden" name="reason" />
            <button
              type="submit"
              title={comment.hidden ? "Показать комментарий" : "Скрыть комментарий"}
              style="background:none;border:0;padding:0;margin-left:6px;color:#999;cursor:pointer;font-size:1em"
            >
              {comment.hidden ? "◉" : "◌"}
            </button>
          </form>
        ) : null}
        {showDelete ? (
          <form
            method="post"
            action={`/topics/${comment.topicId}/delete_comment/${comment.id}/`}
            style="display:inline"
            onsubmit="return confirm('Удалить комментарий?')"
          >
            <button
              type="submit"
              title="Удалить комментарий"
              style="background:none;border:0;padding:0;margin-left:6px;color:#c33;cursor:pointer;font-size:1em"
            >
              ✕
            </button>
          </form>
        ) : null}
      </div>
      <br class="clear" />
    </>
  );
};

const ReplyLink: FC<{ commentId: number }> = ({ commentId }) => (
  <div id={`div_new_comment_${commentId}`} class="div_new_comment clear">
    <a href="#" onclick={`show_add_comment_form(${commentId}); return false;`}>Ответить</a>
  </div>
);

const CommentNode: FC<{
  comment: TopicComment;
  childrenComments: TopicComment[];
  childrenMap: Map<number, TopicComment[]>;
  canDelete: boolean;
  canModerate?: boolean;
  currentUserId: number | null;
}> = ({ comment, childrenComments, childrenMap, canDelete, canModerate = false, currentUserId }) => {
  const isOwn = comment.authorId !== null && comment.authorId === currentUserId;
  const canDeleteThis = canDelete || isOwn;
  const canEditThis = isOwn;
  return (
    <div id={`div_comment_${comment.id}`} class="div_comment">
      <CommentTop comment={comment} showDelete={canDeleteThis && childrenComments.length === 0} showEdit={canEditThis} showHide={canModerate} />
      <div class="div_content_comm" id={`div_content_comm_${comment.id}`}>
        <div class="div_text" dangerouslySetInnerHTML={{ __html: comment.body }} />
        <ReplyLink commentId={comment.id} />
        {childrenComments.map((c) => (
          <CommentNode
            key={c.id}
            comment={c}
            childrenComments={childrenMap.get(c.id) ?? []}
            childrenMap={childrenMap}
            canDelete={canDelete}
            canModerate={canModerate}
            currentUserId={currentUserId}
          />
        ))}
      </div>
    </div>
  );
};

export const CommentFragment: FC<{
  comment: TopicComment;
  canDelete?: boolean;
  canModerate?: boolean;
  currentUserId?: number | null;
}> = ({ comment, canDelete = false, canModerate = false, currentUserId = null }) => {
  const canDeleteThis = canDelete || comment.authorId === currentUserId;
  const canEditThis = comment.authorId !== null && comment.authorId === currentUserId;
  return (
    <div id={`div_comment_${comment.id}`} class="div_comment">
      <CommentTop comment={comment} showDelete={canDeleteThis} showEdit={canEditThis} showHide={canModerate} />
      <div class="div_content_comm" id={`div_content_comm_${comment.id}`}>
        <div class="div_text" dangerouslySetInnerHTML={{ __html: comment.body }} />
        <ReplyLink commentId={comment.id} />
      </div>
    </div>
  );
};

export const CommentList: FC<{
  comments: TopicComment[];
  canDelete?: boolean;
  canModerate?: boolean;
  currentUserId?: number | null;
}> = ({ comments, canDelete = false, canModerate = false, currentUserId = null }) => {
  const commentIds = new Set(comments.map((c) => c.id));
  const childrenMap = new Map<number, TopicComment[]>();
  for (const c of comments) {
    const key = c.parentId;
    if (key !== null && commentIds.has(key)) {
      const list = childrenMap.get(key) ?? [];
      list.push(c);
      childrenMap.set(key, list);
    }
  }
  const roots = comments.filter((c) => c.parentId === null || !commentIds.has(c.parentId));
  const sortedRoots = roots.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  sortedRoots.forEach((c) => {
    const list = (childrenMap.get(c.id) ?? []).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    if (list.length) childrenMap.set(c.id, list);
  });
  return (
    <div>
      {sortedRoots.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          childrenComments={childrenMap.get(c.id) ?? []}
          childrenMap={childrenMap}
          canDelete={canDelete}
          canModerate={canModerate}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
};

export const CommentForm: FC<{ topicId: number; loggedIn: boolean }> = ({
  topicId,
  loggedIn,
}) => (
  <div id="div_comment_0">
    <div class="div_content_comm" id="div_content_comm_0"></div>
    <div id="div_new_comment_0">
      <br />
      <h3 class="h_left_header">
        <a href="#" onclick="show_add_comment_form(0); return false;">Добавить комментарий</a>
        <br />
        <span class="dark" style="font-size:11px">
          Если нужно ответить кому-то конкретно,
          <br />
          лучше нажать на «Ответить» под его комментарием
        </span>
      </h3>
      <br class="clear" />
      {loggedIn ? (
        <form
          method="post"
          id="frm_new_comment"
          data-topic-id={topicId}
          action={`/topics/${topicId}/add_comment/`}
          style="display:none"
        >
          <input type="hidden" name="parent_id" value="0" />
          <textarea
            name="body"
            rows={5}
            style="width:98%;font-size:1.3em;font-family:inherit"
            placeholder="Ваш комментарий..."
          />
          <div style="margin-top:5px">
            <button type="submit" class="blue" style="padding:5px 15px;border:0;cursor:pointer">
              Отправить
            </button>
          </div>
        </form>
      ) : (
        <div class="div_add_comment_noparent">
          <a href="/login" class="a_dashed">
            Войдите, чтобы оставить комментарий
          </a>
        </div>
      )}
    </div>
  </div>
);