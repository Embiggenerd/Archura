#!/usr/bin/env bash
# Watch the GitHub Actions run for a commit (build -> deploy -> adminctl bootstrap).
#
#   deploy-watch.sh               push the current branch, then watch its run
#   deploy-watch.sh --sha <sha>   watch an already-pushed commit's run (no push)
#
# Requires the GitHub CLI, authenticated:  brew install gh && gh auth login
set -euo pipefail

WORKFLOW=core-image.yml
POLL_TRIES=45   # ~90s at 2s each — enough for the push + workflow to register

command -v gh >/dev/null 2>&1 || {
  echo "gh (GitHub CLI) is not installed — run: brew install gh && gh auth login" >&2
  exit 1
}

if [ "${1:-}" = "--sha" ]; then
  sha=${2:?usage: deploy-watch.sh --sha <commit>}
else
  branch=$(git rev-parse --abbrev-ref HEAD)
  echo "> pushing $branch ..."
  git push origin "$branch"
  sha=$(git rev-parse HEAD)
fi

printf '> waiting for a %s run for %s ' "$WORKFLOW" "${sha:0:7}"
run_id=""
for _ in $(seq 1 "$POLL_TRIES"); do
  run_id=$(gh run list --workflow="$WORKFLOW" -L 20 \
    --json databaseId,headSha \
    --jq "map(select(.headSha==\"$sha\")) | .[0].databaseId // empty" 2>/dev/null || true)
  [ -n "$run_id" ] && break
  printf '.'; sleep 2
done
echo

if [ -z "$run_id" ]; then
  {
    echo "no run appeared for ${sha:0:7} within ~90s."
    echo "(the '$WORKFLOW' workflow only runs on pushes to master that change core/**.)"
  } >&2
  exit 1
fi

echo "> watching run $run_id"
exec gh run watch "$run_id" --exit-status
