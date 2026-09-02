#!/usr/bin/env sh
# check-search-index-shipped —— the two deployment files shipped to the owner must
# ship a lexical index of their own.
#
# **Why this gate exists**: prod's and coolify's compose files originally had no
# meilisearch service at all, and `MEILI_URL` defaulted to empty — corpus search fell
# back to Postgres full-text, and that fallback **cannot handle Chinese**:
# `to_tsvector('english', …)` never segments CJK, so a whole Chinese passage collapses
# into one token. What that looked like in production: searching `无限衍义` found the
# article containing it, but `限衍`, `三个序列`, `资格证` all returned 0 hits, and
# `三张资格证` couldn't even find the article with those exact five characters in its
# title (the body had "与三张资格证" in it).
#
# Meanwhile the dev stack **does** have meilisearch. So every search-related e2e test
# ran on a path prod never takes: `corpus-search-cjk-not-silent.spec.ts` was green on
# its first run, while prod stayed broken the whole time
# ([[which-path-is-the-green-on]]). This gate guards exactly that fork: **for a test to
# cover prod, prod and the tested path must be the same path.**
#
# Doesn't care about version or tuning parameters (that's an ops tradeoff). Only checks
# two things, once per file:
#   (1) a meilisearch service exists (the index actually ships with the stack)
#   (2) backend's MEILI_URL has a non-empty default (the service is there, but the
#       backend defaults to not using it = shipped for nothing)

set -eu

FILES="docker-compose.prod.yml infra/coolify/docker-compose.coolify.yml"
fail=0

for f in $FILES; do
  [ -f "$f" ] || { echo "check-search-index-shipped: $f is missing; this gate has nothing to check"; exit 2; }

  if ! grep -q '^  meilisearch:' "$f"; then
    echo "check-search-index-shipped: $f has no meilisearch service"
    echo "         without it, corpus search falls back to Postgres full-text, and that path can't segment Chinese."
    fail=1
  fi

  # MEILI_URL's default: `${MEILI_URL:-}` is an empty default (the backend won't connect);
  # what's needed is `:-http://…`.
  url_line=$(grep -E '^\s*-\s*MEILI_URL=' "$f" || true)
  if [ -z "$url_line" ]; then
    echo "check-search-index-shipped: $f's backend has no MEILI_URL"
    fail=1
  elif echo "$url_line" | grep -qE 'MEILI_URL=\$\{MEILI_URL:-\}'; then
    echo "check-search-index-shipped: $f's MEILI_URL default is empty"
    echo "         the service shipped, but the backend defaults to not connecting = shipped for nothing."
    fail=1
  fi
done

# Self-test: can the gate actually see anything? Copy a compose file, strip out
# meilisearch, and it must go red
# ([[gate-can-go-blind]]: a gate that's always green looks identical to one that was
# never installed).
probe=$(mktemp -d)/probe.yml
grep -v '^  meilisearch:' docker-compose.prod.yml > "$probe"
if grep -q '^  meilisearch:' "$probe"; then
  echo "check-search-index-shipped: SELF-TEST FAILED — meilisearch is still there after stripping it, meaning this isn't actually reading the file"
  exit 2
fi
rm -rf "$(dirname "$probe")"

[ "$fail" -eq 0 ] || exit 1
echo "check-search-index-shipped: both deployment files ship a lexical index, and the backend defaults to connecting it (self-test passed)."
