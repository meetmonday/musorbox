# Phase 3: Forum

## Goal
Implement the forum module: thread listing with tag-based filtering, thread detail view with threaded comments.

## Tasks

### 3.1 Forum Service
- [ ] Create `src/forum/service.ts`:
  - `getForumThreads(page, limit)` - paginated thread list
  - `getThreadsByTag(tagSlug, page, limit)` - filtered by tag
  - `getThreadById(id)` - full thread with nested comments
  - `getTagGroups()` - OS tags and topic tags with weight/popularity
  - `getThreadCount()`, `getThreadCountByTag()`

### 3.2 Forum Components
- [ ] Create `src/forum/components.tsx`:
  - `<ThreadList>` - table of threads (avatar, title, author, reply count, tags, reply button)
  - `<ThreadRow>` - single thread row with alternating dark/light background
  - `<TagFilter>` - two panels: "Операционная система" and "Темы" with tag links
  - `<TagCloud>` - tags sized by popularity (span_tags_menu0..6 classes)
  - `<ForumPagination>` - same as topic pagination but for forum

### 3.3 Forum Routes
- [ ] Create `src/forum/routes.ts`:
  - `GET /public/b_questions/` - forum index (all threads)
  - `GET /public/b_questions/page_topics/:page` - paginated forum
  - `GET /public/b_questions/tags/:tagSlug/` - filtered by tag
  - `GET /public/b_questions/tags/:tagSlug/page_topics/:page` - filtered + paginated

### 3.4 Forum Index Page
- [ ] Assemble forum index:
  - h1 "Форум"
  - Tag filter sidebar (left column, above thread list)
  - Thread listing (20 per page, alternating row colors)
  - Each thread row: avatar | title + author + reply count | tags | "Ответить →"
  - Pagination top and bottom
  - Sidebar with recent discussions + new on site + ad slots

### 3.5 Thread Detail Page (reuse from topics)
- [ ] Forum threads use the same `/topics/:id/:slug` URL pattern as articles
- [ ] Distinguish forum threads from articles by `category.type === 'forum'`
- [ ] Thread view shows:
  - Original post (author, date, tags, content)
  - Nested comment tree (populated in Phase 4)
  - Reply button
  - Tag links (clickable, filter forum by tag)
  - Sidebar with recent discussions

### 3.6 Tag System
- [ ] Seed forum tags from original:
  - OS tags: Android, Java, Symbian variants, Windows Mobile/Phone, iOS, etc.
  - Topic tags: Hardware, Games, Settings, Chat, Purchase, Programs, Firmware, Themes, Trashbox
- [ ] Tag weight/popularity system (determines font-size class: span_tags_menu0..6)
- [ ] Tag URLs: `/public/b_questions/tags/{slug}/`

## Deliverable
Fully functional forum with thread listing, tag filtering, pagination, and thread detail view. Forum index matches original layout with tag cloud and alternating rows.
