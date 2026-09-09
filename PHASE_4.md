# Phase 4: Interactive (Auth + Comments + Votes)

## Goal
Add authentication, comment system with threading, and voting.

## Tasks

### 4.1 Authentication
- [ ] Create `src/auth/service.ts`:
  - `register(username, password)` - hash with bcrypt, create user + session
  - `login(username, password)` - verify, create session
  - `logout(token)` - delete session
  - `getSession(token)` - validate and return user
- [ ] Create `src/auth/routes.ts`:
  - `GET /login` - login form page
  - `POST /login` - authenticate, set cookie, redirect
  - `GET /register` - registration form page
  - `POST /register` - create user, set cookie, redirect
  - `GET /logout` - clear cookie, redirect to /
- [ ] Auth forms styled to match original popup/modal design
- [ ] Session cookie: `session_token`, HttpOnly, 7-day expiry

### 4.2 Comments Module
- [ ] Create `src/comments/service.ts`:
  - `getCommentsByTopicId(topicId)` - flat list, build tree in memory
  - `buildCommentTree(flatComments)` - nest by parent_id
  - `addComment(topicId, parentId, authorId, body)` - insert + update topic comment_count
  - `deleteComment(id, userId)` - only author or admin
- [ ] Create `src/comments/components.tsx`:
  - `<CommentThread>` - recursive nested comment tree
  - `<Comment>` - single comment (avatar, username, medals, date, text, reply link, vote controls)
  - `<ReplyForm>` - inline reply form (appears on "Ответить" click)
  - `<AddCommentForm>` - top-level "Добавить комментарий" form
- [ ] Create `src/comments/routes.ts`:
  - `GET /api/comments/:topicId` - returns comment HTML fragment (for AJAX)
  - `POST /api/comments` - add comment (requires auth)
  - `DELETE /api/comments/:id` - delete comment (author/admin only)

### 4.3 Voting Module
- [ ] Create `src/votes/service.ts`:
  - `vote(userId, entityType, entityId, value)` - upsert vote (+1/-1)
  - `getVoteCounts(entityType, entityId)` - returns {up, down, score}
  - `getUserVote(userId, entityType, entityId)` - current user's vote
  - `updateEntityVotes(entityType, entityId)` - recalculate from votes table
- [ ] Create `src/votes/routes.ts`:
  - `POST /api/vote` - submit vote (requires auth)
  - Returns JSON: `{ score, up, down, userVote }`
- [ ] Client-side `public/js/voting.js`:
  - Click handler for +/- buttons
  - AJAX POST to /api/vote
  - Update vote bar width and color proportionally
  - Show social share overlay on positive vote

### 4.4 Comment Integration
- [ ] Wire comments into topic detail page:
  - Load comments via AJAX on page load
  - "Ответить" links trigger inline reply form
  - "Добавить комментарий" at bottom for top-level comments
  - Each comment has vote controls (type=1)
  - Direct link anchors: `#div_comment_{id}`
- [ ] Wire comments into forum thread view (same component, different context)

### 4.5 Vote Bar Visual
- [ ] Match original vote bar exactly:
  - Blue (#1FB6F2) segment for positive votes
  - Gray (#999999) segment for negative votes
  - Total width: 120px
  - Pixel widths proportional: e.g., 3 upvotes = 90px blue, 1 downvote = 30px gray
  - Score displayed as "+N" or "0"

## Deliverable
Users can register, log in, post comments (threaded), reply to comments, and vote on articles and threads. Vote bars update in real-time via AJAX.
