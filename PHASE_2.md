# Phase 2: Content + Sidebar

## Goal
Render the main news feed page, article detail view, category pages, and sidebar widgets.

## Tasks

### 2.1 Topics Module
- [ ] Create `src/topics/service.ts`:
  - `getTopics(categoryId?, page, limit)` - paginated topic list
  - `getTopicById(id)` - full topic with author, tags, vote counts
  - `getTopicBySlug(id, slug)` - for URL routing
  - `getTopicsByCategory(slug, page, limit)` - filtered by category
  - `getFeaturedTopics(limit)` - for carousel (top 5)
  - `getLeaderboard()` - authors/commenters of the week
  - `getTopicsWithCommentCount()` - for sidebar
- [ ] Create `src/topics/components.tsx`:
  - `<TopicCard>` - article preview in feed (author avatar, title, lead image, excerpt, votes, comment count)
  - `<TopicDetail>` - full article view (author info, title, tags, body, lead image, vote bar, social share area)
  - `<FeaturedCarousel>` - horizontal 5-item carousel with background images
  - `<Leaderboard>` - "Авторы недели" / "Комментаторы недели" two-column table
  - `<TopicMini>` - compact topic item for sidebar lists
  - `<Pagination>` - page numbers with ".." ellipsis and arrow navigation

### 2.2 Main Page Routes
- [ ] Create `src/topics/routes.ts`:
  - `GET /` - main page (news feed, page 1)
  - `GET /page_topics/:page` - paginated news feed
  - `GET /topics/:id/:slug` - article detail view
  - `GET /public/b_news/` - news category
  - `GET /public/b_text/` - articles category
  - `GET /public/reviews/` - reviews category
  - `GET /public/progs/` - programs category
  - `GET /public/games/` - games category
  - `GET /public/themes/` - themes category
  - `GET /public/all_topics/` - all topics

### 2.3 Main Page Layout
- [ ] Assemble main page:
  - FeaturedCarousel at top (after nav, before main content)
  - Leaderboard row (Best Authors + Best Commenters)
  - Two-column layout: topic feed (left) + sidebar (right)
  - Topic cards in feed with full text or truncated + "read more"
  - Pagination at bottom (matching original style: page numbers + ".." + arrows)
  - Google AdSense placeholder slots (responsive breakpoints)

### 2.4 Article Detail Page
- [ ] Assemble article page:
  - Author info (avatar, name, date)
  - Title (h1)
  - Tags area
  - Lead image with lightbox support
  - Article body (HTML)
  - Voting bar (colored proportional bar: blue #1FB6F2 / gray #999)
  - Social share area (placeholder for Phase 4)
  - Comments section (placeholder, populated in Phase 4)
  - Sidebar with recent discussions + new on site

### 2.5 Sidebar Widgets
- [ ] Create `src/sidebar/components.tsx`:
  - `<RecentDiscussions>` - "Свежие обсуждения" (8 items with avatars, comment counts, author chains)
  - `<NewOnSite>` - "Новое на сайте" with RSS icon (8 items)
  - `<HotTopics>` - "Горячие темы" (3 items, visible on some pages)
  - `<AdBanner>` - BetweenDigital 240x400 placeholder
  - `<GoogleAdSense>` - responsive ad slot component

### 2.6 Pagination
- [ ] Implement pagination for topic lists:
  - Top and bottom pagination bars
  - Current page highlighted (`span_item_active`)
  - Ellipsis for large page ranges: "622 621 .. 1"
  - Next arrow: "→"
  - URL pattern: `/page_topics/{N}/`

## Deliverable
Fully functional main page and article pages with working pagination, sidebar widgets, and leaderboard. CSS matching original layout.
