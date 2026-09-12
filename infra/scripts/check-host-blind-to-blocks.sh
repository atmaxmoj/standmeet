#!/usr/bin/env bash
# check-host-blind-to-blocks.sh —— the host must not know WHICH blocks ship.
#
# A built-in block has no standing an installed one lacks. It is a plugin somebody wrote
# ahead of time, and its implementation lives outside the host (mcp-servers/<name>, started
# at runtime). If host code names one, that block is no longer equivalent to a block the
# owner installs: the host does for it something it will not do for the others, and the next
# plugin — shipped or pasted — silently misses whatever that was.
#
# What this caught, all four of them in the composition root, which check-core-agnostic.sh
# excludes by design:
#   - a fragment gate keyed "corpus.retrieval"       → a second corpus reader missed the gate
#   - a `switch id { case "calendar.book" ... }`     → only two blocks could show a dependency
#   - two consts naming two shipped suppliers        → `telegram` and `bearer-api` supply
#                                                      seams too and could never be listed
#   - an api-candidate list typed as {"corpus.retrieval", "calendar.book"}
#
# Each one is now derived from the manifests. So is this guard's own subject: the ids come
# from backend/blocks/*/manifest.yaml, not from a list in this file. Add a block and the gate
# covers it with nothing to remember — which is the whole point, since a list you must
# remember to update is the failure it is guarding against.
#
# Matches a block id as a Go **string literal** ("calendar.book"), on a non-comment line.
# That is the shape of the defect; the same word in prose is documentation.
#
# Excluded, with reasons:
#   - backend/blocks/              the declarations themselves
#   - internal/plugin/adapters/    the supplier layer: protocols ARE its subject
#   - *_test.go                    a test names what it tests
#   - eval-harness/, mcp-servers/  outside the host
#
# Usage:
#   check-host-blind-to-blocks.sh        check (0 = clean, 1 = violations)
#   check-host-blind-to-blocks.sh seed   print the current hit set, for the baseline
#
# Self-test: check-host-blind-to-blocks-test.sh plants a hit and asserts red.

set -euo pipefail
cd "$(dirname "$0")/../.."

BLOCKS_DIR="backend/blocks"
BASELINE="backend/.host-blind-to-blocks-baseline"

# The scan's subject, derived. A missing or empty blocks dir means this guard is blind, not
# that the host is clean —— say so and fail loudly rather than print a reassuring zero.
[ -d "$BLOCKS_DIR" ] ||
  { echo "check-host-blind-to-blocks: $BLOCKS_DIR is missing — the scan is blind." >&2; exit 2; }

ids=$(find "$BLOCKS_DIR" -mindepth 2 -maxdepth 2 -name 'manifest.yaml' \
        -exec grep -hE '^id:[[:space:]]*' {} + | sed 's/^id:[[:space:]]*//' | tr -d '"' | sort -u)
[ -n "$ids" ] ||
  { echo "check-host-blind-to-blocks: no block ids found under $BLOCKS_DIR — the scan is blind." >&2; exit 2; }

files=$(find backend -name '*.go' ! -name '*_test.go' \
          ! -path 'backend/blocks/*' ! -path 'backend/internal/plugin/adapters/*' | sort)

ids_f=$(mktemp)
trap 'rm -f "$ids_f"' EXIT

# current_hits —— one awk pass over every scanned file.
#
# One pass, not a grep per (file, id): the first draft was that nested loop and it ran ~6000
# greps, which took long enough to read as a hang rather than as a slow check. A guard nobody
# waits for is a guard nobody runs.
current_hits() {
  printf '%s\n' "$ids" > "$ids_f"
  printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 awk -v idfile="$ids_f" '
    BEGIN { while ((getline id < idfile) > 0) if (id != "") quoted[id] = "\"" id "\"" }
    /^[[:space:]]*(\/\/|\*)/ { next }
    { for (id in quoted) if (index($0, quoted[id])) print FILENAME "\t" id }
  ' | sort -u
}

if [ "${1:-check}" = "seed" ]; then
  current_hits
  exit 0
fi

hits_f=$(mktemp); base_f=$(mktemp)
trap 'rm -f "$hits_f" "$base_f" "$ids_f"' EXIT
current_hits > "$hits_f"
sort -u "$BASELINE" 2>/dev/null > "$base_f" || true

new=$(comm -23 "$hits_f" "$base_f")
stale=$(comm -13 "$hits_f" "$base_f")

rc=0
if [ -n "$new" ]; then
  echo "check-host-blind-to-blocks: host code names a block that ships with the image." >&2
  echo "Derive it instead — the block declares it (provides/requires/host_ops/visitor_tools)," >&2
  echo "and the host reads the declaration. A built-in is not special:" >&2
  printf '%s\n' "$new" | sed 's/^/  + /' >&2
  rc=1
fi
if [ -n "$stale" ]; then
  echo "check-host-blind-to-blocks: baseline entries no longer present — delete them from $BASELINE" >&2
  echo "(the baseline can only shrink):" >&2
  printf '%s\n' "$stale" | sed 's/^/  - /' >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  n=$(printf '%s\n' "$ids" | wc -l | tr -d ' ')
  if [ -s "$BASELINE" ]; then
    b=$(wc -l < "$BASELINE" | tr -d ' ')
    echo "check-host-blind-to-blocks: clean against baseline ($n block ids scanned, $b known)."
  else
    echo "check-host-blind-to-blocks: host names no shipped block ($n block ids scanned)."
  fi
fi
exit "$rc"
