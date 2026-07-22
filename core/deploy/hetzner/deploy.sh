#!/usr/bin/env bash
set -Eeuo pipefail

deploy_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$deploy_dir"

if [[ ! -f .env ]]; then
  echo "missing $deploy_dir/.env; copy .env.example and set production values" >&2
  exit 1
fi
if [[ ! -f release.env ]]; then
  echo "missing $deploy_dir/release.env; run release.sh with an immutable image" >&2
  exit 1
fi
if [[ ! -s certs/origin.pem || ! -s certs/origin-key.pem ]]; then
  echo "missing Cloudflare Origin Certificate files in $deploy_dir/certs" >&2
  exit 1
fi

compose=(docker compose --env-file .env --env-file release.env)

"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d --remove-orphans

for attempt in {1..40}; do
  if "${compose[@]}" exec -T core wget -q -O /dev/null http://127.0.0.1:8080/readyz; then
    "${compose[@]}" ps
    echo "core is ready"
    # Bootstrap the platform workspace and (best-effort) grant the platform owner.
    # Idempotent and self-healing: `bootstrap` exits 0 even when the owner account
    # doesn't exist yet (it logs "sign up, then re-run"), so the grant lands on the
    # next deploy after they sign up. Non-fatal — core is already serving.
    "${compose[@]}" --profile jobs run --rm adminctl bootstrap \
      || echo "note: adminctl bootstrap failed — check DB connectivity and PLATFORM_OWNER_EMAIL" >&2
    exit 0
  fi
  sleep 3
done

"${compose[@]}" logs --tail=100 core >&2
echo "core did not become ready" >&2
exit 1
