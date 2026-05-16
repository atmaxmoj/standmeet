#!/usr/bin/env bash
# check-max-lines: cap the line count of every Go source file under
# internal/ + cmd/.  Same per-file budget MainApp / Auth enforce via
# ESLint `max-lines` — long files almost always mean a missing
# package split or a god-handler hiding multiple concerns.
#
# Blank + comment lines are NOT excluded: a 500-line file is hard to
# navigate whether the 500 are code or doc, and gofmt prevents the
# "comment out everything to dodge the limit" loophole.
#
# Generated files are exempt — wire_gen.go grows with the dep graph
# and isn't human-edited.

set -euo pipefail

MAX_LINES=350
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Use a portable `find … | while read` loop instead of `mapfile`
# (macOS ships bash 3.2 which doesn't have it).  NUL-delimited reads
# survive paths with spaces.
violations=0
total=0
while IFS= read -r -d '' f; do
  total=$((total + 1))
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt "$MAX_LINES" ]; then
    echo "check-max-lines: ${f#$ROOT/} has $lines lines (max $MAX_LINES) — split it."
    violations=$((violations + 1))
  fi
done < <(find "$ROOT/cmd" "$ROOT/internal" -name '*.go' -not -name 'wire_gen.go' -print0 2>/dev/null)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "Long files almost always mean a missing package split or a god"
  echo "handler hiding multiple concerns.  Carve out a sub-package or"
  echo "one-file-per-aggregate before reaching for an exemption."
  exit 1
fi

echo "check-max-lines: $total files scanned, all under $MAX_LINES lines."
