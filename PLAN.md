# Trashbox.ru Recreation

Server-side recreation of Trashbox.ru (2013 Russian mobile tech portal) on a modern stack.

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | **Bun** | Native SQLite, fast |
| HTTP | **Hono** | Lightweight, SSR-ready, JSX templates |
| ORM/DB | **Drizzle ORM + Bun SQLite** | Typed, migrations, zero external deps |
| Templates | **JSX (Hono JSX)** | SSR HTML components, type-safe |
| Auth | **cookie-session + bcrypt** | No external deps, server sessions |
| CSS | **Vanilla CSS (original as base)** | 1:1 visual fidelity to 2013 original |

## Project Structure

```
trashbox/
├── src/
│   ├── core/                    # Infrastructure
│   │   ├── config.ts
│   │   ├── db.ts
│   │   ├── schema.ts
│   │   ├── middleware.ts
│   │   └── utils.ts
│   ├── auth/                    # Authentication
│   │   ├── routes.ts
│   │   └── service.ts
│   ├── users/                   # User profiles
│   │   ├── routes.ts
│   │   ├── service.ts
│   │   └── components.tsx
│   ├── topics/                  # Content (news/articles)
│   │   ├── routes.ts
│   │   ├── service.ts
│   │   └── components.tsx
│   ├── forum/                   # Forum
│   │   ├── routes.ts
│   │   ├── service.ts
│   │   └── components.tsx
│   ├── comments/                # Comments
│   │   ├── routes.ts
│   │   ├── service.ts
│   │   └── components.tsx
│   ├── votes/                   # Voting
│   │   ├── routes.ts
│   │   └── service.ts
│   ├── sidebar/                 # Shared sidebar widgets
│   │   └── components.tsx
│   ├── layout/                  # Page layout
│   │   ├── layout.tsx
│   │   ├── header.tsx
│   │   └── footer.tsx
│   └── app.ts
├── public/
│   ├── css/
│   ├── images/
│   ├── js/
│   └── avatars/
├── drizzle/
├── PLAN.md
├── PHASE_1.md
├── PHASE_2.md
├── PHASE_3.md
├── PHASE_4.md
├── PHASE_5.md
├── package.json
├── tsconfig.json
└── .gitignore
```

## Database Schema

```sql
users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT DEFAULT 'user',
  avatar_url    TEXT,
  country       TEXT,
  city          TEXT,
  vk_url        TEXT,
  twitter_url   TEXT,
  skype         TEXT,
  devices       TEXT,
  rating_optout BOOLEAN DEFAULT 0,
  topics_count  INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)

sessions (
  token   TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  expires DATETIME
)

categories (
  id        INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id),
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL,
  type      TEXT,
  sort_order INTEGER DEFAULT 0
)

topics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,
  body          TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  author_id     INTEGER REFERENCES users(id),
  lead_image    TEXT,
  votes_up      INTEGER DEFAULT 0,
  votes_down    INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_pinned     BOOLEAN DEFAULT 0,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME
)

tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL
)

topic_tags (
  topic_id INTEGER REFERENCES topics(id),
  tag_id   INTEGER REFERENCES tags(id),
  PRIMARY KEY (topic_id, tag_id)
)

comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id    INTEGER REFERENCES topics(id),
  parent_id   INTEGER REFERENCES comments(id),
  author_id   INTEGER REFERENCES users(id),
  body        TEXT NOT NULL,
  votes_up    INTEGER DEFAULT 0,
  votes_down  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
)

votes (
  user_id     INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  value       INTEGER NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, entity_type, entity_id)
)

firms (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
)
```

## Phases

- [Phase 1: Core + Layout](PHASE_1.md) - Project setup, DB, shared layout
- [Phase 2: Content + Sidebar](PHASE_2.md) - News feed, articles, carousel, leaderboards
- [Phase 3: Forum](PHASE_3.md) - Forum threads, tag filtering, pagination
- [Phase 4: Interactive](PHASE_4.md) - Auth, comments, voting
- [Phase 5: Profile + Polish](PHASE_5.md) - User profiles, search, RSS, visual tuning

## Estimated Resources

| Component | Files | Lines (~) |
|-----------|-------|-----------|
| core | 5 | ~400 |
| auth | 2 | ~150 |
| layout | 3 | ~500 |
| topics | 3 | ~600 |
| forum | 3 | ~500 |
| comments | 3 | ~400 |
| votes | 2 | ~150 |
| users | 3 | ~400 |
| sidebar | 1 | ~200 |
| public/ (CSS+JS+images) | ~15 | ~2000 |
| **Total** | **~40** | **~5300** |

**Time estimate:** ~20-30 hours for full implementation.
