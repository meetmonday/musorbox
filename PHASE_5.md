# Phase 5: Profile + Polish

## Goal
User profiles, search, RSS, and final visual polish for 1:1 fidelity.

## Tasks

### 5.1 User Profile
- [ ] Create `src/users/service.ts`:
  - `getProfile(username)` - full profile with stats
  - `updateProfile(userId, data)` - update fields
  - `uploadAvatar(userId, file)` - save to public/avatars/, return URL
  - `getUserTopics(username, page)` - topics by user
  - `getUserStats(username)` - topics_count, comments_count
- [ ] Create `src/users/components.tsx`:
  - `<UserProfile>` - profile display (name, role, avatar, location, social links, devices)
  - `<ProfileEditForm>` - editable form with multipart upload for avatar
  - `<UserTopics>` - link to user's topics with count
- [ ] Create `src/users/routes.ts`:
  - `GET /users/:username` - view profile
  - `POST /users/:username` - update profile (auth required, own profile only)
  - `GET /user_topics/:username/` - user's topic list with pagination

### 5.2 Profile Page Layout
- [ ] Match original profile layout:
  - Avatar (left) + name/role/stats (right)
  - "Обсуждаемых топиков: N"
  - "Все топики Username [N]" link
  - Rating opt-out badge (red #ff4d4d)
  - Country, City
  - Social links: VK, Twitter, Skype
  - Devices list
  - Profile editing form (multipart/form-data)

### 5.3 Search
- [ ] Create search endpoint:
  - `GET /public/search/?string=query` - search topics by title + body
  - Full-text search using SQLite FTS5
  - Results page with pagination
- [ ] Search forms:
  - Top bar inline search (visible on all pages)
  - Logo area search (larger, visible on some breakpoints)

### 5.4 RSS Feeds
- [ ] Create RSS feed endpoints:
  - `GET /feed_topics/b_news/` - news RSS (RSS 2.0 format)
  - `GET /feed_topics/1/` - all topics RSS
  - `GET /feed_topics/b_questions/` - forum RSS
- [ ] RSS components:
  - `<rss>` XML template with `<channel>`, `<item>` elements
  - Each item: title, link, description, pubDate, author

### 5.5 Social Sharing
- [ ] Implement social share component:
  - VKontakte share button
  - Twitter share button
  - Facebook share button
  - Google+ share button
  - Open Graph meta tags in `<head>`
  - Twitter Card meta tags
- [ ] Social icon sprite (icons_social6.png - already extracted)

### 5.6 Photo Lightbox
- [ ] Create `public/js/photo_modal.js`:
  - Click on article image opens modal overlay
  - Full-size image with navigation arrows
  - Close button (X) and click-outside-to-close
  - Image gallery navigation (prev/next)
- [ ] Match original lightbox styling

### 5.7 Device Selector
- [ ] Implement device/firm selector in top bar:
  - `<select>` with 90+ manufacturers from firms table
  - Second `<select>` for models (loaded via AJAX)
  - Form POST to set user's device preference
  - Persists to user profile

### 5.8 Visual Polish (1:1 Fidelity)
- [ ] Compare each page with archived originals:
  - Main page: layout, fonts, spacing, colors
  - Article page: voting bar, comments, sidebar
  - Forum: tag cloud sizing, row striping, thread layout
  - Profile: field layout, badge styling
- [ ] Responsive design:
  - Mobile (<360px): adh0 hidden elements
  - Tablet (360-520px): adh1 elements
  - Desktop (>520px): adh2 elements
  - Toggle: "Отключить адаптацию под устройство"
- [ ] Typography matching:
  - Font sizes, weights, line heights
  - Color palette: #1FB6F2 (blue accent), #999 (gray), #ff4d4d (red badges)
  - Russian text rendering
- [ ] Micro-layouts:
  - Table-based alignment for vote controls
  - Float clearing with clearfix pattern
  - `<nobr>` usage in compact areas
- [ ] SEO:
  - Meta description, keywords per page
  - Open Graph tags
  - Semantic heading hierarchy (h1 > h2 > h3)
  - `<noindex>` for non-content blocks

## Deliverable
Complete recreation with all features functional. Pixel-perfect (or near-pixel-perfect) match to the 2013 originals. All 5 page types rendering correctly: main page, article, forum index, forum thread, user profile.
