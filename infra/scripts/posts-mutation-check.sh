#!/usr/bin/env bash
# posts-mutation-check —— posts-tests.md § "Mutation check": each planted bug must turn its specs red.
#
# A privacy spec that stays green on a broken rule is decoration. For every row of
# posts-mutations.tsv this script, in a scratch worktree of HEAD with its own dev stack:
#   1. resets the tree, applies the row's substitution, and FAILS the row if nothing changed;
#   2. runs each of the row's commands and wants each one red — and red from a failed assertion
#      (a Playwright "N failed" summary, a gate's refusal or its "self-test: FAILED"), never from a
#      build that broke, which would be red for every row alike.
# Before any mutation the same commands run once on the clean tree and must all be green — a spec
# that is already red proves nothing about any mutation.
#
# Runs HEAD, not the working tree: commit first. ONLY=<id>[,<id>…] runs a subset.

set -eu

ROOT="$(git rev-parse --show-toplevel)"
TABLE="$ROOT/infra/scripts/posts-mutations.tsv"
WORK="$(mktemp -d)"
TREE="$WORK/tree"
LOG="$WORK/logs"
mkdir -p "$LOG"

cleanup() {
  (cd "$TREE" && make dev-down >/dev/null 2>&1) || true
  git -C "$ROOT" worktree remove --force "$TREE" >/dev/null 2>&1 || true
  echo "posts-mutation-check: logs kept in $LOG"
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$TREE" HEAD >/dev/null
(cd "$TREE" && pnpm install --frozen-lockfile --prefer-offline >/dev/null && make stack-init >/dev/null)

rows() {
  grep -vE '^(#|[[:space:]]*$)' "$TABLE" | while IFS=$'\t' read -r id glob expr cmds; do
    if [ -z "${ONLY:-}" ] || printf ',%s,' "$ONLY" | grep -q ",$id,"; then
      printf '%s\t%s\t%s\t%s\n' "$id" "$glob" "$expr" "$cmds"
    fi
  done
}

# run_cmd <log> <cmd> —— 0 green, 1 red from an assertion, 2 red from anything else.
run_cmd() {
  if (cd "$TREE" && eval "$2") </dev/null >"$1" 2>&1; then return 0; fi
  grep -qE '[0-9]+ failed|self-test: FAILED|^check-posts-one-reader: .* outside ' "$1" && return 1
  return 2
}

each_cmd() { printf '%s\n' "$1" | awk 'BEGIN{RS=";;"} {gsub(/^[ \n]+|[ \n]+$/, ""); if ($0 != "") print}'; }

fail=0
echo "posts-mutation-check: baseline — every named command green on the clean tree"
rows | cut -f4 | while read -r c; do each_cmd "$c"; done | sort -u >"$WORK/cmds"
while read -r cmd; do
  log="$LOG/baseline-$(printf '%s' "$cmd" | tr -c 'a-zA-Z0-9' '_').log"
  if ! run_cmd "$log" "$cmd"; then
    echo "  RED on the clean tree: $cmd ($log)"
    fail=1
  fi
done <"$WORK/cmds"
[ "$fail" -eq 0 ] || { echo "posts-mutation-check: the clean tree is red; fix that first."; exit 1; }

rows | while IFS=$'\t' read -r id glob expr cmds; do
  git -C "$TREE" checkout -q -- .
  files=$(cd "$TREE" && ls $glob 2>/dev/null || true)
  if [ -n "$files" ]; then (cd "$TREE" && perl -0777 -pi -e "$expr" $files); fi
  if git -C "$TREE" diff --quiet; then
    echo "  $id: FAILED — the substitution matched nothing in $glob; point the row at the real line"
    echo x >>"$LOG/failed"
    continue
  fi
  each_cmd "$cmds" | while read -r cmd; do
    log="$LOG/$id-$(printf '%s' "$cmd" | tr -c 'a-zA-Z0-9' '_').log"
    st=0; run_cmd "$log" "$cmd" || st=$?
    case $st in
      1) echo "  $id: red as it must — $cmd" ;;
      0) echo "  $id: FAILED — stayed green: $cmd (that spec is decoration; rewrite it)"; echo x >>"$LOG/failed" ;;
      *) echo "  $id: FAILED — red, but not from an assertion (build? setup?): $cmd ($log)"; echo x >>"$LOG/failed" ;;
    esac
  done
done
git -C "$TREE" checkout -q -- .

if [ -f "$LOG/failed" ]; then
  echo "posts-mutation-check: $(wc -l <"$LOG/failed" | tr -d ' ') row result(s) failed."
  exit 1
fi
echo "posts-mutation-check: every planted bug turned its specs red."
