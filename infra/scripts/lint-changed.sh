#!/usr/bin/env bash
# lint-changed.sh —— the pre-push gate, scoped to what this push changes.
#
# The whole-repo `make lint` took 5–11 minutes per push (646s on 2026-09-30), most of it the
# backend's whole-module golangci + arch + build chain, paid even when the push touched no Go at
# all. This runs the same lint targets, but only for the subprojects the push changes, measured
# against the remote main it will land on:
#
#   backend/**     → backend-lint backend-no-mock
#   sdk/**         → sdk-lint app-lint   (the app compiles against the SDK)
#   app/**         → app-lint
#   e2e/**         → e2e-lint
#   im-bridge/**   → im-bridge-lint
#   docs/real-env-verification/** → verify-items
#   anything else  → the full `make lint` (infra/, the Makefile, root manifests and lockfile feed
#                    every subproject; a path this map does not know is treated the same way)
#
# secrets and env-lint always run: they take seconds and guard a leak / a deploy drift.
# FULL_LINT=1 forces the full chain.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git fetch -q origin main 2>/dev/null || true
base=$(git merge-base HEAD origin/main 2>/dev/null || echo "")

if [ "${FULL_LINT:-}" = "1" ] || [ -z "$base" ]; then
  echo "[lint-changed] full lint (${FULL_LINT:+FULL_LINT=1}${base:-no merge-base with origin/main})"
  exec make lint
fi

targets="secrets env-lint"
full=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    backend/*)                      targets="$targets backend-lint backend-no-mock" ;;
    sdk/*)                          targets="$targets sdk-lint app-lint" ;;
    app/*)                          targets="$targets app-lint" ;;
    e2e/*)                          targets="$targets e2e-lint" ;;
    im-bridge/*)                    targets="$targets im-bridge-lint" ;;
    docs/real-env-verification/*)   targets="$targets verify-items" ;;
    docs/*|*.md)                    ;;
    *)                              full=1 ;;
  esac
done < <(git diff --name-only "$base" HEAD)

if [ "$full" = "1" ]; then
  echo "[lint-changed] a shared path changed — full lint"
  exec make lint
fi

# De-duplicate, keeping the order above.
uniq_targets=$(echo "$targets" | tr ' ' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ' ')
echo "[lint-changed] changed since $(git rev-parse --short "$base"): make $uniq_targets"
# shellcheck disable=SC2086
exec make $uniq_targets
