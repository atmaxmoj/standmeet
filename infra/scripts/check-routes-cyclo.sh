#!/usr/bin/env bash
# check-routes-cyclo: faces and facades may only declare and delegate.
#
# Rule: every function under internal/routes/ and inside every domain's facade
# package must stay at cyclomatic complexity <= 3.
#
# Why the whole package and not just HTTP handlers: branching is what business
# logic looks like. Once a face decides "how this thing is computed", only the
# callers that come through that face get the rule — vault sync, the job loop
# and every other entry point do not, so they grow their own copy and the two
# drift. This gate used to cover handler functions only, and explicitly
# excluded dispatcher/ mcphandle/ capload/ on the grounds that "they decode
# schemaless JSON by hand, so the branching is inherent". That reason does not
# hold: decoding can move onto an args type or a domain function, while
# excluding whole packages waved through actual business (deriving a code from
# a label, merging quotas, validating enums all arrived that way).
#
# Facades are the same case: a facade re-exports and delegates. A branch inside
# one means the domain and its front door disagree about the rule.
#
# The baseline may only shrink. Each line is a function the migration has not
# split yet; fix one, delete its line. Wanting to add a line is exactly the
# thing this gate exists to stop.

set -euo pipefail

MAX_CYCLO=3
ROOT="$(cd "${1:-.}" && pwd)"  # target Go source root (make -C backend → CWD=backend)
GOCYCLO="$(go env GOPATH)/bin/gocyclo"
BASELINE_FILE="$(cd "$(dirname "$0")" && pwd)/check-routes-cyclo-baseline.txt"

# socket.go: long-lived read/write loops, where the select/case branching is
# the protocol itself rather than a business decision.
SKIP='socket\.go'

target_dirs() {
  echo "$ROOT/internal/routes/"
  find "$ROOT/internal" -type d -name facade | sort
}

# gocyclo prints "<n> <pkg> <func> <file>:<line>". Identity is "<pkg> <func>":
# line numbers drift with unrelated edits, and a baseline keyed on them would
# go red for no reason.
scan_keys() {
  # shellcheck disable=SC2046
  # gocyclo exits non-zero when -over finds anything, which is the normal case
  # here — swallow the status, the comparison below is what decides.
  "$GOCYCLO" -over "$MAX_CYCLO" $(target_dirs) 2>/dev/null \
    | grep -vE "$SKIP" | awk '{print $2" "$3}' | sort -u || true
}

current="$(scan_keys)"
baseline="$(grep -vE '^\s*(#|$)' "$BASELINE_FILE" | sort -u || true)"

new="$(comm -23 <(printf '%s\n' "$current") <(printf '%s\n' "$baseline") | grep -v '^$' || true)"
if [ -n "$new" ]; then
  echo "check-routes-cyclo: new function above cyclo $MAX_CYCLO in a face or facade."
  echo "Branching means business: move it into the domain and leave the face"
  echo "with a declaration and a call."
  echo ""
  printf '%s\n' "$new"
  exit 1
fi

stale="$(comm -13 <(printf '%s\n' "$current") <(printf '%s\n' "$baseline") | grep -v '^$' || true)"
# shellcheck disable=SC2046
total="$("$GOCYCLO" $(target_dirs) 2>/dev/null | grep -cvE "$SKIP" || true)"

# 扫到 0 个函数 = 扫描器瞎了,不是代码干净。真发生过:从 repo 根跑(而不是 backend/)时
# target_dirs 全部指向不存在的路径,find 报错到 stderr,而这里照样打印一句绿色的
# "0 functions scanned ... ratchet holds"。绿必须以"确实读到了东西"为前提。
if [ "$total" -eq 0 ]; then
  echo "check-routes-cyclo: scanned 0 functions — the scanner is blind, not the code clean." >&2
  echo "(run it from backend/, e.g. 'make -C backend routes-cyclo')" >&2
  exit 1
fi
left="$(printf '%s\n' "$baseline" | grep -cv '^$' || true)"

summary="check-routes-cyclo: $total functions scanned in routes/ + every domain facade"
if [ -n "$stale" ]; then
  n="$(printf '%s\n' "$stale" | grep -cv '^$' || true)"
  echo "$summary ($left baselined, $n already clean — delete them from the baseline)."
elif [ "$left" -gt 0 ]; then
  echo "$summary ($left baselined left to split, ratchet holds)."
else
  echo "$summary, all ≤ $MAX_CYCLO (baseline empty)."
fi
