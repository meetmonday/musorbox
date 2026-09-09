# Phase 1: Core + Layout

## Goal
Set up the project skeleton, database, and shared page layout (header, nav, footer).

## Tasks

### 1.1 Project Initialization
- [ ] `bun init` in project root
- [ ] Install dependencies:
  - `hono` - HTTP framework
  - `drizzle-orm` + `drizzle-kit` - ORM + migrations
  - `bcryptjs` - password hashing
- [ ] Configure `tsconfig.json` (JSX support, strict mode)
- [ ] Configure `bunfig.toml`

### 1.2 Database Setup
- [ ] Create `src/core/schema.ts` - all Drizzle table definitions
- [ ] Create `src/core/db.ts` - SQLite connection + Drizzle instance
- [ ] Run initial migration to create all tables
- [ ] Create seed script with sample data:
  - 3-5 test users (including admin/editor roles)
  - 10+ categories (matching original: Новости, Статьи, Обзоры, Форум, etc.)
  - 20+ tags (OS tags + topic tags from original)
  - 3-5 firm/device entries
  - 10+ sample topics (mix of news and forum threads)

### 1.3 Core Utilities
- [ ] Create `src/core/config.ts` - port, DB path, session secret, etc.
- [ ] Create `src/core/middleware.ts`:
  - Session middleware (cookie-based, reads `sessions` table)
  - Auth middleware (attaches `user` to context if session valid)
  - Error handling middleware
- [ ] Create `src/core/utils.ts`:
  - `slugify(text: string)` - URL-safe slugs from Russian text
  - `formatDate(date: Date)` - Russian date format "5 августа 2013 - 17:32"
  - `pluralize(n, one, few, many)` - Russian pluralization for "ответов"

### 1.4 Shared Layout
- [ ] Create `src/layout/layout.tsx`:
  - `<Layout>` wrapper component accepting `title`, `user`, `children`
  - Two-column div_table layout (left main + right sidebar)
  - Include header and footer
- [ ] Create `src/layout/header.tsx`:
  - Top user bar (auth link / profile button, search, scroll controls)
  - Logo area with tagline "лучший мобильный портал"
  - Two-row navigation menu matching original links
  - "Добавить топик" button (links to login if not authenticated)
- [ ] Create `src/layout/footer.tsx`:
  - Copyright "2008-2013 Бобылёв.ру"
  - Links: Правила, Мобильная версия, Благодарности, Правообладателям, Реклама
  - Social icons: RSS, VK, Twitter, Facebook
  - "Отключить адаптацию" toggle
- [ ] Extract original CSS from `dumps/Главная — Trashbox.ru_files/all201307305128.gz_siAb.css`
  - Decompress and adapt to `public/css/main.css`
  - Extract responsive breakpoints to `public/css/responsive.css`

### 1.5 Static Assets
- [ ] Copy sprite images from dumps to `public/images/`:
  - `blank.gif` (1x1 transparent spacer)
  - `icons_social6.png` (social icon sprite)
  - `loop_min.png` (search icon)
  - Default avatar image
- [ ] Extract/create Trashbox logo
- [ ] Copy all avatars from dumps to `public/avatars/`

### 1.6 App Entry Point
- [ ] Create `src/app.ts`:
  - Initialize Hono app
  - Register static file serving (`public/`)
  - Register middleware
  - Register route groups (placeholder for now)
  - Start Bun.serve()

## Deliverable
A running server that serves the shared layout (header + nav + footer) with correct styling. Navigation links visible but non-functional. Database seeded with sample data.
