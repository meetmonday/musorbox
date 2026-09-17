#!/bin/sh
# Supervisor for the MusorBox container: runs `bun run start` and,
# when TUNNEL_TOKEN is set, a Cloudflare (Named/Quick) tunnel in the same
# container. Restarts whichever process dies; exits cleanly on SIGTERM/SIGINT.

set -u

TUNNEL_TOKEN="${TUNNEL_TOKEN:-}"

app_pid=""
cf_pid=""

start_app() {
  echo "[entrypoint] launching musorbox app (bun run start)"
  bun run start &
  app_pid=$!
}

start_tunnel() {
  cf_pid=""
  if [ -n "$TUNNEL_TOKEN" ]; then
    echo "[entrypoint] launching cloudflared tunnel"
    cloudflared tunnel --no-autoupdate run --token "$TUNNEL_TOKEN" &
    cf_pid=$!
  else
    echo "[entrypoint] TUNNEL_TOKEN is empty, skipping cloudflared"
  fi
}

shutdown() {
  echo "[entrypoint] signal received, shutting down"
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null
  [ -n "$cf_pid" ] && kill "$cf_pid" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap shutdown INT TERM

start_app
start_tunnel

while :; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    echo "[entrypoint] app process died, restarting"
    start_app
  fi
  if [ -n "$cf_pid" ] && ! kill -0 "$cf_pid" 2>/dev/null; then
    echo "[entrypoint] cloudflared died, restarting"
    start_tunnel
  fi
  sleep 3
done