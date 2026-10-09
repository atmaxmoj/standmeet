#!/usr/bin/env bash
# check-posts-one-reader —— a post reaches anyone only through the posts package.
#
# A post's audience (private / public / roles) is decided by one function, posts.VisibleTo /
# GetVisible (docs/design/posts.md, "Every outbound surface"). A second reader would be a second
# copy of that rule, and the copy is where a private post leaks. So, outside the posts package
# (backend/internal/corpus/posts/) and its sqlc query dir (backend/db/queries/posts/), the gate
# refuses:
#   1. a Go import of the posts repo (internal/corpus/posts/db or .../repo);
#   2. an sqlc query file that names the `posts` table;
#   3. a Meili document write for posts: a Go file that builds a search.Doc and names the post
#      genre ("post", "post://", GenrePost).
#
# ROOT —— the repo root to scan (the self-test points it at a planted tree).

set -eu

ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PKG="backend/internal/corpus/posts"
QUERIES="backend/db/queries/posts"

cd "$ROOT"
fail=0

report() {
  if [ -n "$2" ]; then
    echo "check-posts-one-reader: $1 outside $PKG:"
    echo "$2"
    fail=1
  fi
}

gofiles=$(find backend -name '*.go' -not -path "$PKG/*" 2>/dev/null || true)

imports=$(printf '%s\n' "$gofiles" | grep . | xargs grep -nE '"[^"]*/internal/corpus/posts/(db|repo)"' \
  2>/dev/null || true)
report "an import of the posts repo" "$imports"

tables=$(find backend/db/queries -name '*.sql' -not -path "$QUERIES/*" 2>/dev/null \
  | xargs grep -niE '(from|join|into|update)[[:space:]]+posts([^a-z0-9_]|$)' 2>/dev/null || true)
report "an sqlc query naming the posts table" "$tables"

docs=""
for f in $(printf '%s\n' "$gofiles" | grep . | xargs grep -lE 'search\.Doc\{' 2>/dev/null || true); do
  hit=$(grep -nE '"post"|"post://|GenrePost' "$f" || true)
  [ -n "$hit" ] && docs="$docs$f: $hit
"
done
report "a search document for posts" "$docs"

if [ "$fail" -ne 0 ]; then
  echo "  → read posts through posts.VisibleTo / posts.GetVisible; index them from the posts package."
  exit 1
fi
echo "check-posts-one-reader: posts are read, queried and indexed only in $PKG."
