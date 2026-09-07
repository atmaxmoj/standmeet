#!/usr/bin/env sh
# check-no-hardcoded-dev-stack —— nothing may name a dev container literally.
#
# **Why this gate exists.** One machine runs N checkouts, each with its own compose project and
# its own published ports (`.dev-stack.env`). Anything that writes `standmeet-dev-db-1` addresses
# whichever checkout happens to be called that — not the one it belongs to.
#
# The failure is silent and it lands on someone else. `eval-harness/reseed-marcus.sh` did exactly
# this: run from a second checkout it TRUNCATEd the first checkout's `owners` table and then
# claimed an instance it was not about to talk to. The person on the other stack lost their
# session mid-run with nothing on their screen to connect it to, and the script itself reported
# success. `infra/scripts/schema-drift` did the read-only version: it compared the FIRST
# checkout's live database against the second one's `schema.sql` and reported the difference as
# drift — a real-looking finding about a database it had never been pointed at.
#
# Both were missed when the per-checkout stack landed, because the change swept the Makefile, the
# compose file and the e2e fixture, and stopped there. So the rule is enforced instead of
# remembered ([[lesson-not-swept-to-neighbours]]).
#
# The rule: `standmeet-dev` may appear only as a FALLBACK DEFAULT — the value a derivation lands
# on when a checkout has no `.dev-stack.env`. Every other spelling addresses a stack, and the
# stack it addresses is not necessarily this one.
#
# The first version of this gate matched only `standmeet-dev-`, the container-name prefix. It
# then missed `docker compose -p standmeet-dev` in password-reset.spec.ts — same defect, one
# character short of the pattern, and the gate reported the tree clean
# ([[verifier-can-lie-about-its-own-coverage]]). Both forms are caught now, which is why the
# allowed list below is a list of DEFAULTING syntaxes rather than a list of files.
#
# Comments are scanned too, deliberately. A comment telling a person to run
# `docker exec <a literal container> …` sends them at the wrong stack just as surely as code
# does, and they will not be reading this gate at the time.

set -eu

# The legacy reference trees are not built and not run (see CLAUDE.md); they predate the
# per-checkout stack and nothing in them addresses a live container.
EXCLUDE='^\(standmeet-client\|standmeet-server\|standmeet-e2e\)/'

# ADDRESSING —— the two shapes that actually POINT AT a stack:
#
#   standmeet-dev-<svc>   a container name, for `docker exec`
#   -p standmeet-dev      the project flag, for `docker compose`
#
# Two patterns rather than "the word appears anywhere", because the word appears legitimately in
# six places — the compose file's own default, the Makefile's, the e2e fixture's, the python
# script's, the example env file's worked example, and the comments explaining all of them. A
# gate that forbids the default it tells you to fall back to is a gate people delete.
#
# Neither pattern can match a defaulting syntax: `${...:-standmeet-dev}-db-1` has a brace between
# the name and the dash, `?? 'standmeet-dev'` has a quote, and `+ "-db-1"` is a separate token.
ADDRESSING='standmeet-dev-[a-z]\|-p standmeet-dev'

# scan —— every tracked line addressing the dev stack by name. Empty output = clean.
# `git grep` walks tracked files only, so build output and node_modules cannot produce noise.
scan() {
  git grep -n -e 'standmeet-dev-[a-z]' -e '\-p standmeet-dev' \
    -- . ":!infra/scripts/check-no-hardcoded-dev-stack.sh" \
    | grep -v "$EXCLUDE" || true
}

# self-test: BOTH violation shapes must go red, and every defaulting syntax must stay green.
#
# Both shapes, because the first version of this gate matched only the container name and then
# reported a tree clean that still had `-p standmeet-dev` in it — one character short of the
# pattern ([[verifier-can-lie-about-its-own-coverage]]). And the green half matters too: a gate
# that greps for something it cannot reach passes on a dirty tree and says so cheerfully
# ([[gate-can-go-blind]]).
selftest() {
  for planted in \
    "$(printf 'docker exec standmeet-dev-%s-1 psql' 'db')" \
    "$(printf 'docker compose -p standmeet-dev %s' 'exec')"
  do
    echo "$planted" | grep -q "$ADDRESSING" \
      || { echo "check-no-hardcoded-dev-stack: self-test failed — did not catch: $planted"; exit 2; }
  done
  for ok in \
    'DB=${COMPOSE_PROJECT_NAME:-standmeet-dev}-db-1' \
    'COMPOSE_PROJECT_NAME ?= standmeet-dev' \
    "const P = process.env['COMPOSE_PROJECT_NAME'] ?? 'standmeet-dev';" \
    'os.environ.get("COMPOSE_PROJECT_NAME", "standmeet-dev") + "-db-1"' \
    'name: standmeet-dev'
  do
    echo "$ok" | grep -q "$ADDRESSING" \
      && { echo "check-no-hardcoded-dev-stack: self-test failed — the gate rejects a legitimate default: $ok"; exit 2; }
  done
  return 0
}

selftest
violations=$(scan)
if [ -n "$violations" ]; then
  echo "check-no-hardcoded-dev-stack: the dev stack is addressed by a literal name —"
  echo "$violations" | sed 's/^/  /'
  echo "  Derive it instead. Go: the Makefile exports COMPOSE_PROJECT_NAME to every recipe."
  echo "  e2e: import DB_CONTAINER / REDIS_CONTAINER / COMPOSE_ARGS from fixtures/instance."
  echo "  A script run BY HAND sources .dev-stack.env itself (see eval-harness/reseed-marcus.sh)."
  exit 1
fi
count=$(git grep -l -F 'standmeet-dev' -- . | wc -l | tr -d ' ')
echo "check-no-hardcoded-dev-stack: nothing addresses the dev stack by name; $count file(s) carry it as a fallback default only"
echo "                              (self-test passed: both violation shapes go red, all five defaulting syntaxes stay green)."
