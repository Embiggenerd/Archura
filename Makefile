# Developer convenience targets. The watch targets need the GitHub CLI (gh),
# authenticated: `brew install gh && gh auth login`.
.PHONY: install-hooks deploy-watch watch runs

# Install the pre-push hook: pushing master to origin auto-tails its CI/CD run.
# Idempotent; the installed hook just delegates to scripts/git-hooks/pre-push.
install-hooks:
	@printf '#!/usr/bin/env bash\nexec "$$(git rev-parse --show-toplevel)/scripts/git-hooks/pre-push" "$$@"\n' > .git/hooks/pre-push
	@chmod +x .git/hooks/pre-push scripts/git-hooks/pre-push scripts/deploy-watch.sh
	@echo "installed .git/hooks/pre-push -> scripts/git-hooks/pre-push"

# Push the current branch and tail the CI/CD run it triggers (manual equivalent
# of the hook, for when the hook is skipped or not installed).
deploy-watch:
	@scripts/deploy-watch.sh

# Tail the latest "Core image" run without pushing.
watch:
	@gh run watch $$(gh run list --workflow=core-image.yml -L1 --json databaseId --jq '.[0].databaseId') --exit-status

# List recent CI/CD runs.
runs:
	@gh run list --workflow=core-image.yml
