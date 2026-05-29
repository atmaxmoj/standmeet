#!/usr/bin/env bash
# trim.sh — 把 .raw/ 里的 GitHub 捕获截短到我们用得到的字段，写进 git path。
# 用法：bash e2e/fixtures/marketplace/trim.sh
# 或经 Makefile: make trim-marketplace-fixtures

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
