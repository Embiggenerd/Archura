#!/bin/sh
# Bring up the whole local stack for manual testing:
#   Postgres + Go core (with edge auth) + the Vite frontend.
# Prints URLs + keys, then runs Vite in the foreground. Ctrl-C stops the core;
# Postgres is left running for fast restarts. Does not edit ./core — only runs it.
#
#   sh archura-editor/scripts/dev-up.sh
set -eu
export LC_ALL=C LANG=C

here=$(cd "$(dirname "$0")" && pwd)
av2=$(cd "$here/.." && pwd)
core_dir=$(cd "$av2/../core" && pwd)
pgdata=/tmp/archura-pg
pgport=54329

cleanup() {
  echo ""
  echo "› stopping core (postgres stays up)…"
  lsof -ti :8080 2>/dev/null | xargs kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- Postgres ---
if [ ! -d "$pgdata" ]; then
  echo "› initializing postgres at $pgdata"
  initdb -D "$pgdata" -U postgres --auth=trust >/dev/null
fi
pg_ctl -D "$pgdata" -o "-p $pgport -k /tmp" -l /tmp/archura-pg.log start >/dev/null 2>&1 || true
sleep 2
createdb -h /tmp -p "$pgport" -U postgres archura 2>/dev/null || true

# --- Core keys ---
cd "$core_dir"
admin=$(go run ./cmd/devkeys admin | cut -d= -f2)
service=$(go run ./cmd/devkeys service | cut -d= -f2)

# --- Core (background) ---
DATABASE_URL="postgres://postgres@/archura?host=/tmp&port=$pgport" \
PLATFORM_ADMIN_KEY="$admin" CORE_SERVICE_KEY="$service" \
REQUIRE_EDGE_AUTH=true PORT=8080 ARCHURA_ENV=dev \
  go run ./cmd/server > /tmp/core-run.log 2>&1 &

echo "› waiting for core…"
i=0
while [ $i -lt 40 ]; do
  curl -s http://localhost:8080/healthz >/dev/null 2>&1 && break
  sleep 1
  i=$((i + 1))
done

cat <<INFO

────────────────────────────────────────────────────────────
  Editor:              http://localhost:5173/edit/            (component picker)
  Editor (component):  http://localhost:5173/edit/?component=payments/StripePayment
  Component demo:      http://localhost:5173/demo/?component=payments/StripePayment
    (any ?param=value sets a component property, e.g. &amount=5000&button-label=Donate;
     the demo defaults a Stripe TEST key from .env so payment forms are real —
     pass your own &stripe-publishable-key=pk_test_… to override. Embedded
     components never default a key.)
  Core:                http://localhost:8080   (logs: /tmp/core-run.log)

  PLATFORM_ADMIN_KEY=$admin
  CORE_SERVICE_KEY=$service

  Identity loop test (another shell):
    CORE_ADMIN_KEY=$admin CORE_SERVICE_KEY=$service \\
      node archura-editor/scripts/verify-core-identity.mjs

  Ctrl-C stops the core + Vite (postgres keeps running).
────────────────────────────────────────────────────────────

INFO

# --- Vite (foreground; Ctrl-C triggers the trap) ---
cd "$av2"
npx vite
