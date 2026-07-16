#!/usr/bin/env bash
set -Eeuo pipefail

deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$deploy_dir"

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
: "${BACKUP_DIR:=/var/backups/archura-core}"
: "${BACKUP_RETENTION_DAYS:=7}"
: "${OFFSITE_BACKUP_DEST:?Set OFFSITE_BACKUP_DEST to an rclone remote and bucket path}"

command -v rclone >/dev/null || {
  echo "rclone is required for off-server backups" >&2
  exit 1
}

compose=(docker compose --env-file .env --env-file release.env)

install -d -m 0700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || {
  echo "another backup is already running" >&2
  exit 1
}

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
name="archura-${POSTGRES_DB}-${timestamp}.dump"
temporary="$BACKUP_DIR/.${name}.partial"
final="$BACKUP_DIR/$name"
trap 'rm -f "$temporary"' EXIT

"${compose[@]}" exec -T postgres sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' \
  >"$temporary"

test -s "$temporary"
mv "$temporary" "$final"
(
  cd "$BACKUP_DIR"
  sha256sum "$name" >"$name.sha256"
)

rclone copyto "$final" "${OFFSITE_BACKUP_DEST%/}/$name"
rclone copyto "$final.sha256" "${OFFSITE_BACKUP_DEST%/}/$name.sha256"

find "$BACKUP_DIR" -type f \( -name 'archura-*.dump' -o -name 'archura-*.dump.sha256' \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -delete

echo "database backup uploaded: ${OFFSITE_BACKUP_DEST%/}/$name"
