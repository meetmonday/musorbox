# syntax=docker/dockerfile:1

# --- cloudflared binary (from the official image, arch-aware) ---
FROM cloudflare/cloudflared:latest AS cloudflared

# --- runtime ---
FROM oven/bun:1 AS runtime

WORKDIR /app

# install prod deps first (better layer caching)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# source + migrations
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts tsconfig.json ./

# cloudflared from the first stage
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared

# static assets ship empty; host mounts ./public over this dir
RUN mkdir -p /app/public

# entrypoint supervisor
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV PORT=3000 \
    DB_PATH=/data/musorbox.db

EXPOSE 3000
VOLUME ["/data", "/app/public"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:${PORT}/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]