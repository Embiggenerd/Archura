#!/bin/sh
# Bring up the whole local stack for manual testing:
#   Postgres + Go core (with edge auth) + a watched frontend build served by
#   Wrangler, which owns both the app and its API routes on port 8787.
# Prints staged progress as each piece comes up, then the frontend URL, then
# waits on Wrangler. Ctrl-C stops the local stack; Postgres is left running for
# fast restarts. Does not edit ./core — only runs it.
#
#   sh scripts/dev-up.sh          (lives at the repo root: it orchestrates
#                                  core + editor + Worker, not one package)
set -eu
export LC_ALL=C LANG=C

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
av2="$root/archura-editor"
core_dir="$root/core"
pgdata=/tmp/archura-pg
pgport=54329
pidfile=/tmp/archura-dev-pids

child_pids=""
cleaned_up=false

# --- Progress output -------------------------------------------------------
# Colours only when stdout is a terminal; plain otherwise (logs, pipes).
if [ -t 1 ]; then
  c_dim=$(printf '\033[2m'); c_grn=$(printf '\033[32m')
  c_yel=$(printf '\033[33m'); c_bld=$(printf '\033[1m'); c_rst=$(printf '\033[0m')
else
  c_dim=; c_grn=; c_yel=; c_bld=; c_rst=
fi
start_ts=$(date +%s)
elapsed() { printf '%ss' "$(( $(date +%s) - start_ts ))"; }
step() { printf '%s▸%s %s %s(%s)%s\n' "$c_yel" "$c_rst" "$*" "$c_dim" "$(elapsed)" "$c_rst"; }
ok()   { printf '  %s✓%s %s\n' "$c_grn" "$c_rst" "$*"; }
# wait_for <url> <label> [max_seconds]: poll once a second, printing a dot each
# tick so the wait is visible; a ✓ on success, a ✗ on timeout.
wait_for() {
  _url=$1; _label=$2; _max=${3:-40}; _i=0
  printf '  %swaiting for %s%s ' "$c_dim" "$_label" "$c_rst"
  while [ $_i -lt $_max ]; do
    if curl -s "$_url" >/dev/null 2>&1; then
      printf ' %s✓%s\n' "$c_grn" "$c_rst"
      return 0
    fi
    printf '.'
    sleep 1
    _i=$((_i + 1))
  done
  printf ' %s✗%s\n' "$c_yel" "$c_rst"
  return 1
}

printf '%sBringing up the Archura local stack%s\n' "$c_bld" "$c_rst"

# Local Stripe test settings live in the ignored root .env. Billing is enabled
# only when the secret, webhook signing secret, and recurring Price are all
# present; the rest of the stack still starts while those are being set up.
if [ -f "$root/.env" ]; then
  set -a
  . "$root/.env"
  set +a
fi
stripe_secret=${STRIPE_SECRET_KEY:-${STRIPE_TEST_SECRET_KEY:-}}
stripe_webhook=${STRIPE_WEBHOOK_SECRET:-}
stripe_price=${STRIPE_BASIC_PRICE_ID:-}
stripe_origin=${BILLING_PUBLIC_ORIGIN:-http://localhost:8787}
unset STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_BASIC_PRICE_ID BILLING_PUBLIC_ORIGIN
if [ -n "$stripe_secret" ] && [ -n "$stripe_webhook" ] && [ -n "$stripe_price" ]; then
  export STRIPE_SECRET_KEY="$stripe_secret"
  export STRIPE_WEBHOOK_SECRET="$stripe_webhook"
  export STRIPE_BASIC_PRICE_ID="$stripe_price"
  export BILLING_PUBLIC_ORIGIN="$stripe_origin"
  printf '  %sbilling: enabled%s\n' "$c_dim" "$c_rst"
else
  printf '  %sbilling: disabled (set STRIPE_* in .env to enable)%s\n' "$c_dim" "$c_rst"
fi

record_pid() {
  child_pids="$child_pids $1"
  printf '%s\n' "$1" >> "$pidfile"
}

stop_recorded_stack() {
  [ -f "$pidfile" ] || return 0
  while IFS= read -r pid; do
    case "$pid" in
      ''|*[!0-9]*) continue ;;
    esac
    command=$(ps -p "$pid" -o command= 2>/dev/null || true)
    case "$command" in
      *"$root"*) kill "$pid" 2>/dev/null || true ;;
    esac
  done < "$pidfile"
  rm -f "$pidfile"
}

cleanup() {
  [ "$cleaned_up" = false ] || return 0
  cleaned_up=true
  [ -n "$child_pids" ] && kill $child_pids 2>/dev/null || true
  pgrep -f "$core_dir/.air.toml" 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :8080 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :9091 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :8787 2>/dev/null | xargs kill 2>/dev/null || true
  lsof -ti :5300 2>/dev/null | xargs kill 2>/dev/null || true
  rm -f "$pidfile"
}
trap cleanup EXIT INT TERM

# Preflight: a half-dead previous stack (stale core holding the metrics port,
# old watchers rewriting dist, or a mismatched service key) breaks the new one.
step 'clearing any previous stack'
stop_recorded_stack
# Clean up processes launched by older dev-up.sh versions that predate pidfile.
pgrep -f "$av2/node_modules/.bin/vite build --watch" 2>/dev/null | xargs kill 2>/dev/null || true
pgrep -f "$av2/node_modules/.bin/wrangler dev --port 8787" 2>/dev/null | xargs kill 2>/dev/null || true
pgrep -f "$core_dir/.air.toml" 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :8080 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :9091 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :8787 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti :5300 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1
: > "$pidfile"

# --- Postgres ---
step 'starting Postgres'
# PG_VERSION check: a stale half-cleaned /tmp dir is not a cluster; re-init it
if [ ! -f "$pgdata/PG_VERSION" ]; then
  rm -rf "$pgdata"
  initdb -D "$pgdata" -U postgres --auth=trust >/dev/null
fi
pg_ctl -D "$pgdata" -o "-p $pgport -k /tmp" -l /tmp/archura-pg.log start >/dev/null 2>&1 || true
sleep 2
createdb -h /tmp -p "$pgport" -U postgres archura 2>/dev/null || true
ok "Postgres ready on :$pgport"

# --- Core keys ---
step 'minting dev keys (first run compiles Go tools)'
cd "$core_dir"
admin=$(go run ./cmd/devkeys admin | cut -d= -f2)
service=$(go run ./cmd/devkeys service | cut -d= -f2)
internal=$(go run ./cmd/devkeys internal | cut -d= -f2)
moderation=$(openssl rand -hex 32)
ok 'dev keys minted'

# --- Core (background, watched by Air) ---
step 'starting Go core watcher'
DATABASE_URL="postgres://postgres@/archura?host=/tmp&port=$pgport" \
PLATFORM_ADMIN_KEY="$admin" CORE_SERVICE_KEY="$service" \
CORE_INTERNAL_KEY="$internal" \
REQUIRE_EDGE_AUTH=true PORT=8080 ARCHURA_ENV=dev \
CONFIRM_URL_BASE="http://localhost:8787/confirm" \
  go tool air -c "$core_dir/.air.toml" > /tmp/core-run.log 2>&1 &
record_pid "$!"

if wait_for http://localhost:8080/healthz 'core /healthz' 40; then
  ok 'core is healthy'
else
  printf '%s\n' 'Core failed to start; see /tmp/core-run.log' >&2
  exit 1
fi

# --- Platform owner (adminctl reads PLATFORM_OWNER_EMAIL from the sourced .env) ---
# Bootstraps the ops workspace and grants staff to that email. Non-fatal: on a
# fresh DB the account won't exist until you sign up, so re-running dev-up (or
# `adminctl bootstrap`) after signup grants it.
if [ -n "${PLATFORM_OWNER_EMAIL:-}" ]; then
  step "granting platform owner ($PLATFORM_OWNER_EMAIL)"
  if ( cd "$core_dir" && DATABASE_URL="postgres://postgres@/archura?host=/tmp&port=$pgport" \
      ARCHURA_ENV=dev PLATFORM_OWNER_EMAIL="$PLATFORM_OWNER_EMAIL" \
      go run ./cmd/adminctl grant-staff > /tmp/archura-adminctl.log 2>&1 ); then
    ok 'platform owner granted (visit /ops/)'
  else
    ok "owner not granted yet — sign up as $PLATFORM_OWNER_EMAIL, then re-run (see /tmp/archura-adminctl.log)"
  fi
fi

# --- Worker (wrangler dev against the built app; the funnel lives here) ---
step 'building frontend'
cd "$av2"
if ! npm run build > /tmp/archura-build.log 2>&1; then
  printf '%s\n' 'Frontend build failed; see /tmp/archura-build.log' >&2
  exit 1
fi
ok 'frontend built'

# Source changes re-emit dist/ automatically; Wrangler serves the new assets
# and its native live reload refreshes open app pages.
step 'starting file watchers (vite + components)'
ARCHURA_WATCH=1 "$av2/node_modules/.bin/vite" build --watch > /tmp/archura-watch-app.log 2>&1 &
record_pid "$!"
node "$av2/scripts/build-components.mjs" --watch > /tmp/archura-watch-components.log 2>&1 &
record_pid "$!"
ok 'watchers running'

# .dev.vars wires the local Worker to the local core. Regenerated every run
# because the service key is minted fresh above; a hand-made .dev.vars is
# backed up once instead of clobbered.
if [ -f .dev.vars ] && ! grep -q "generated by dev-up.sh" .dev.vars; then
  cp .dev.vars .dev.vars.bak
fi
cat > .dev.vars <<VARS
# generated by dev-up.sh — matches the core started alongside it
CORE_URL=http://localhost:8080
CORE_SERVICE_KEY=$service
# Local links: wrangler dev simulates the prod route host, so the Worker
# needs telling where it actually is (used by siteUrlFor for "open your site")
PUBLIC_ORIGIN=http://localhost:8787
# Explicit local compatibility for claim-token-only sites. Never set in prod.
ALLOW_ANONYMOUS_SITE_CLAIMS=true
MODERATION_ADMIN_KEY=$moderation
# Machine credential for the core's internal endpoints (entitlement, release).
CORE_INTERNAL_KEY=$internal
# Dev-only blanket /api/core/* forward for local scripts. Never set in prod —
# production browsers reach core only through the purpose-built BFF routes.
ALLOW_CORE_DEV_PROXY=true
VARS

step 'starting Worker (wrangler dev) + toy client'
"$av2/node_modules/.bin/wrangler" dev --port 8787 --live-reload > /tmp/archura-wrangler.log 2>&1 &
wrangler_pid=$!
record_pid "$wrangler_pid"

node "$av2/toy-client/server.mjs" > /tmp/archura-practice-client.log 2>&1 &
record_pid "$!"
if ! wait_for http://localhost:8787/ 'frontend on :8787' 40; then
  printf '%s\n' 'Frontend failed to start; see /tmp/archura-wrangler.log' >&2
  exit 1
fi

printf '\n  %s✓ stack ready%s in %s\n' "$c_grn$c_bld" "$c_rst" "$(elapsed)"
printf '  %s➜%s  %shttp://localhost:8787/%s\n\n' "$c_grn" "$c_rst" "$c_bld" "$c_rst"

# Keep the stack attached to this terminal; Ctrl-C triggers cleanup.
wait "$wrangler_pid"
