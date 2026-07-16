#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 ghcr.io/owner/archura-core:git-<40-character-sha>" >&2
  exit 2
fi

image=$1
if [[ ! $image =~ ^ghcr\.io/[a-z0-9._/-]+:git-[0-9a-f]{40}$ && \
      ! $image =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]]; then
  echo "refusing mutable or invalid Core image: $image" >&2
  exit 2
fi

deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$deploy_dir"

if [[ ! -f .env ]]; then
  echo "missing $deploy_dir/.env" >&2
  exit 1
fi

umask 077
temporary=$(mktemp "$deploy_dir/.release.env.XXXXXX")
trap 'rm -f "$temporary"' EXIT
printf 'CORE_IMAGE=%s\n' "$image" >"$temporary"

if [[ -f release.env ]]; then
  install -m 0600 release.env release.previous.env
fi
mv "$temporary" release.env
trap - EXIT

if ! ./deploy.sh; then
  echo "release failed; inspect logs, then run ./rollback.sh if the previous image is compatible" >&2
  exit 1
fi

echo "released $image"
