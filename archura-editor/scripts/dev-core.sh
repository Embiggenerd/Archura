#!/bin/sh
# Bring up the local core stack for testing: Postgres + the Go core.
# Prints a fresh PLATFORM_ADMIN_KEY and the verify command, then runs the core
# in the foreground (Ctrl-C to stop). Does not edit ./core — only runs it.
#
#   sh archura-editor/scripts/dev-core.sh
#   # in another shell:
#   CORE_ADMIN_KEY=<printed key> node archura-editor/scripts/verify-core-identity.mjs
set -eu
export LC_ALL=C
export LANG=C

core_dir=$(cd "$(dirname "$0")/../../core" && pwd)
pgdata=/tmp/archura-pg
pgport=54329

if [ ! -d "$pgdata" ]; then
  echo "› initializing postgres at $pgdata"
  initdb -D "$pgdata" -U postgres --auth=trust >/dev/null
fi
pg_ctl -D "$pgdata" -o "-p $pgport -k /tmp" -l /tmp/archura-pg.log start >/dev/null 2>&1 || true
sleep 2
createdb -h /tmp -p "$pgport" -U postgres archura 2>/dev/null || true

cd "$core_dir"
admin=$(go run ./cmd/devkeys admin | cut -d= -f2)
service=${CORE_SERVICE_KEY:-}
if [ "${REQUIRE_EDGE_AUTH:-false}" = "true" ] && [ -z "$service" ]; then
  service=$(go run ./cmd/devkeys service | cut -d= -f2)
fi
echo "› PLATFORM_ADMIN_KEY=$admin"
if [ -n "$service" ]; then
  echo "› CORE_SERVICE_KEY=$service"
  echo "› identity verify:  CORE_ADMIN_KEY=$admin CORE_SERVICE_KEY=$service node archura-editor/scripts/verify-core-identity.mjs"
else
  echo "› identity verify:  CORE_ADMIN_KEY=$admin node archura-editor/scripts/verify-core-identity.mjs"
fi
echo "› core: http://localhost:8080  (Ctrl-C to stop; postgres keeps running)"

export DATABASE_URL="postgres://postgres@/archura?host=/tmp&port=$pgport"
export PLATFORM_ADMIN_KEY="$admin"
if [ -n "$service" ]; then
  export CORE_SERVICE_KEY="$service"
fi
export PORT=8080
exec go run ./cmd/server
