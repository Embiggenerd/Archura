#!/usr/bin/env bash
set -Eeuo pipefail

deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$deploy_dir"

if [[ ! -f release.previous.env ]]; then
  echo "no previous release is available" >&2
  exit 1
fi

previous=$(sed -n 's/^CORE_IMAGE=//p' release.previous.env)
if [[ -z $previous || $previous == *$'\n'* ]]; then
  echo "release.previous.env is invalid" >&2
  exit 1
fi

exec ./release.sh "$previous"
