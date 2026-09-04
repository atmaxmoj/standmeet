#!/usr/bin/env bash
# trim.sh — trim the GitHub captures in .raw/ down to the fields we use, written to the git path.
# Usage: bash e2e/fixtures/marketplace/trim.sh
# or via Makefile: make trim-marketplace-fixtures

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
RAW="$ROOT/.raw"

if [ ! -d "$RAW" ]; then
  echo "no .raw/ found — run capture.sh first"
  exit 1
fi

# GitHub contents endpoint returns 11 fields per entry; the marketplace
# client only reads name / type / html_url. Trim each entry down so the
# fixture stays small (~30 entries × 3 fields).
echo "[GITHUB]"
mkdir -p "$ROOT/github"
jq 'map({name, type, html_url})' "$RAW/github/contents.json" \
  > "$ROOT/github/contents.json"
echo "  ✓ contents.json"
