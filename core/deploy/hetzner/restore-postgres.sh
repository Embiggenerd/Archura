#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 || $2 != "--confirm-destroy-database" ]]; then
  echo "usage: $0 /path/to/backup.dump --confirm-destroy-database" >&2
  exit 2
fi

if [[ $1 = /* ]]; then
  backup_file=$1
else
  backup_file="$PWD/$1"
fi
deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$deploy_dir"

if [[ ! -r $backup_file ]]; then
  echo "backup is not readable: $backup_file" >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "missing $deploy_dir/.env" >&2
  exit 1
fi
if [[ ! -f release.env ]]; then
  echo "missing $deploy_dir/release.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${POSTGRES_DB:?Set POSTGRES_DB in .env}"
: "${POSTGRES_USER:?Set POSTGRES_USER in .env}"

compose=(docker compose --env-file .env --env-file release.env)

"${compose[@]}" stop core
"${compose[@]}" exec -T postgres sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --force "$POSTGRES_DB"; createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$POSTGRES_DB"'
"${compose[@]}" exec -T postgres sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' \
  <"$backup_file"
"${compose[@]}" up -d core

echo "database restored; run ./deploy.sh to verify readiness and the full stack"
