#!/usr/bin/env sh
# check-redis-bounded —— the deployment file shipped to the owner must cap redis
# and give it an eviction policy.
#
# **Why this gate exists (F-R-10)**: redis holds **visitor sessions, rate-limit
# buckets, the job pool (1-day TTL)**, and `docker-compose.prod.yml` originally
# had only a single `image: redis:7-alpine` line — no `command:`, and no memory
# limit on the container either. Running as-is means `maxmemory 0` +
# `maxmemory-policy noeviction`.
#
# Those two defaults together mean: **memory is uncapped, growing until the host
# can't take it**; and if someone caps it externally, `noeviction` makes writes
# **fail outright** instead of dropping the oldest entries.
# Self-hosted boxes tend to be small, so the real failure mode is **the redis
# container gets OOM-killed and every session goes at once** — not "the oldest
# session gets evicted". One person's instance quietly dies, and all they see is
# "visitors say it won't load".
#
# What the cap should actually be is an ops tradeoff (tied to machine size), so
# this check **doesn't care about the number** — it only checks three things:
#   (1) there is a `--maxmemory` (capped)
#   (2) there is a `--maxmemory-policy`, and it isn't `noeviction` (drop something
#       at the cap, don't reject writes)
#   (3) the value can be overridden by an environment variable (machines of
#       different sizes shouldn't require editing compose)
#
# Only checks the prod file: the dev/verify stacks are test rigs, not shipped to anyone.

set -eu

FILE="docker-compose.prod.yml"
fail=0

[ -f "$FILE" ] || { echo "check-redis-bounded: $FILE is gone; this gate has no subject"; exit 2; }

# redis_block —— extract the redis service's definition (up to the next sibling key).
redis_block() {
  awk '/^  redis:/ { inblock = 1; next }
       inblock && /^  [a-z]/ { inblock = 0 }
       inblock { print }' "$1"
}

# flatten —— collapse the whole block onto one line for matching. `command:` has
# two forms (a single string / a one-item-per-line list); in the list form each
# token is on its own line, so a pattern like "`--maxmemory` followed by a space"
# would never match at all.
# The first version broke exactly here: the regex was wrong, not the compose
# file ([[read-the-failure-before-theorising]]).
flatten() { tr '\n' ' ' | tr -s ' '; }

block=$(redis_block "$FILE" | flatten)

printf '%s' "$block" | grep -q -- '--maxmemory[ ]' || {
  echo "check-redis-bounded: redis has no --maxmemory in $FILE"
  echo "                     unbounded means the container grows until the host kills it,"
  echo "                     and every visitor session goes at once (F-R-10)."
  fail=1
}

policy=$(printf '%s' "$block" | grep -o -- '--maxmemory-policy - *[a-z-]*' \
  | awk '{print $NF}')
[ -n "$policy" ] || policy=$(printf '%s' "$block" \
  | grep -o -- '--maxmemory-policy [a-z-]*' | awk '{print $2}')
case "$policy" in
  '')
    echo "check-redis-bounded: redis has no --maxmemory-policy in $FILE"
    fail=1
    ;;
  noeviction)
    echo "check-redis-bounded: policy is noeviction — at the cap, writes FAIL instead of"
    echo "                     dropping the oldest key. A visitor gets an error the owner"
    echo "                     never sees. Pick an evicting policy (allkeys-lru / volatile-ttl)."
    fail=1
    ;;
  *) ;;
esac

printf '%s' "$block" | grep -q '\${' || {
  echo "check-redis-bounded: the cap is not overridable by an environment variable —"
  echo "                     a 1 GB box and a 64 GB box should not need different compose files."
  fail=1
}

# Self-test: plant a redis with only "image", no "command" (i.e. the shape
# before the fix) — this must go red.
planted=$(mktemp -t redischeck.XXXXXX)
cat > "$planted" <<'PLANTED'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
  gotenberg:
    image: gotenberg/gotenberg:8
PLANTED
if printf '%s' "$(redis_block "$planted")" | grep -q -- '--maxmemory '; then
  echo "check-redis-bounded: SELF-TEST FAILED — a redis with no command must look unbounded"
  rm -f "$planted"; exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-redis-bounded: redis is capped, evicts at the cap, and the cap is tunable by env."
