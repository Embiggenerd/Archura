#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 CORE_IMAGE GHCR_USERNAME < GHCR_TOKEN" >&2
  exit 2
fi

image=$1
username=$2
if [[ -z $username || ${#username} -gt 100 ]]; then
  echo "invalid GHCR username" >&2
  exit 2
fi

deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
docker_config=$(mktemp -d)
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG=$docker_config

docker login ghcr.io --username "$username" --password-stdin >/dev/null
"$deploy_dir/release.sh" "$image"
