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

# ── the same rule, one layer down: a PORT that addresses a stack ────────────────────────────
#
# A compose service can hand the BROWSER a URL. `STORAGE_PUBLIC_URL` (presigned objects) and
# `GOOGLE_AUTH_URL` (the OAuth consent hop) are both of these: the browser runs on the host, so
# the URL must name a PUBLISHED port. Every other URL in that file names the internal network
# (`external-mock:9000`), where a literal port is correct and required.
#
# Both host-visible ones were written literally, and both were missed by the sweep that
# parameterised the `ports:` lists — because a `ports:` entry looks like a port and an
# environment value looks like a string. `STORAGE_PUBLIC_URL=http://localhost:9200` sent every
# presigned URL to whichever stack owned 9200: 404 NoSuchKey, which reads as the product losing
# files. `GOOGLE_AUTH_URL=http://localhost:9000` sent the OAuth dance to a neighbour's mock,
# which had no matching state: 401, which reads as OAuth being broken. Seven specs red, and the
# first hour of diagnosis went into the product.
#
# The list of ports is DERIVED from the example env file, so a knob added tomorrow is covered
# without anyone editing this gate ([[reframes-tasks-into-enforced-invariants]]).

# knob_defaults —— every port the example file declares a default for, one per line.
knob_defaults() {
  grep -E '^(DEV|PROD)_PORT_[A-Z_]+=[0-9]+$' .dev-stack.env.example | cut -d= -f2 | sort -u
}

# port_pattern —— those ports as one alternation, after `localhost` and a SEPARATOR.
#
# The separator is itself an alternation, and that is the whole point. The first version of this
# rule matched a literal colon only, and read the tree as clean while `writings.spec.ts` asserted
#
#     expect(src).toMatch(/localhost(%3A|:)9200/)
#
# — the default minio port, in a spec that then failed on a checkout publishing 9600. The literal
# `localhost:9200` never appears there, so the gate could not see it: a verifier reporting clean
# coverage it does not have ([[verifier-can-lie-about-its-own-coverage]]). The encoded spelling is
# not exotic — a Next-optimized `src` carries the presigned URL as an ENCODED query parameter, so
# any spec asserting on one is pushed toward exactly this form.
#
# Three spellings, enumerated rather than approximated: a fuzzy "localhost, then some junk, then
# the port" would swallow unrelated lines, and `%3A` contains alphanumerics so the obvious
# character-class shortcut does not work either.
#
# `localhost:${DEV_PORT_…:-9000}` still does not match — a `$` follows the colon there, not a digit.
port_pattern() {
  printf 'localhost(:|%%3A|\\(%%3A\\|:\\))(%s)' "$(knob_defaults | tr '\n' '|' | sed 's/|$//')"
}

# scan_ports —— host-visible URLs in the compose files naming a default port literally.
# `CMD` lines are healthchecks, which run INSIDE the container: there `localhost:<internal port>`
# is the correct spelling, and the internal port may collide with another service's published
# default (minio answers on 9000 internally, which is external-mock's published default).
scan_ports() {
  for f in docker-compose.dev.yml docker-compose.prod.yml; do
    [ -f "$f" ] || continue
    grep -nE "$(port_pattern)" "$f" | grep -v 'CMD' | while read -r line; do
      echo "$f:$line"
    done
  done
}

# scan_e2e_ports —— the same rule in the suite, where the correct spelling is an env read with
# the default as its FALLBACK (`process.env['APP_BASE_URL'] ?? 'http://localhost:38127'`). A bare
# literal is the violation: `e2e/fixtures/admin.ts` set every spec's `owners.public_url` to the
# default app port that way, and the backend builds its outbound links from that column — the QR
# URL, the OAuth redirect_uri, the email-confirmation link. In an offset checkout all three
# pointed at a NEIGHBOUR's instance, which held neither the OAuth state nor the pending-email
# token. Seven specs red across two families that looked unrelated.
#
# Three things are skipped, and each is a place where a literal is the CORRECT spelling:
#
#   comment lines          several explain the default by naming it, and a comment reaches nothing.
#   e2e/manual/            recorded evidence of a past round — the URL a QR actually decoded to.
#                          Rewriting it would falsify the record.
#   `stack-port-ok: <why>` a literal that is a PAYLOAD, not an address: the SSRF lists assert that
#                          the connector REFUSES loopback, so the port is beside the point and
#                          making it track a knob would be noise. The reason is required — an
#                          unexplained marker is how an exemption becomes a hole.
scan_e2e_ports() {
  git grep -nE "$(port_pattern)" -- e2e ':!e2e/manual' \
    | grep -v 'process\.env' \
    | grep -vE 'stack-port-ok: *[^ ]' \
    | grep -vE ':[0-9]+:[[:space:]]*(//|\*|#)' || true
}

# selftest_ports —— the literal must go red, the derived spelling and a non-knob port must not.
selftest_ports() {
  pat=$(port_pattern)
  bad='      - GOOGLE_AUTH_URL=http://localhost:9000/google-oauth/auth'
  echo "$bad" | grep -qE "$pat" \
    || { echo "check-no-hardcoded-dev-stack: port self-test failed — did not catch: $bad"; exit 2; }
  for ok in \
    '      - GOOGLE_AUTH_URL=http://localhost:${DEV_PORT_EXTERNAL_MOCK:-9000}/google-oauth/auth' \
    '      - STORAGE_PUBLIC_URL=http://localhost:${DEV_PORT_MINIO:-9200}' \
    '      test: ["CMD", "curl", "-fsS", "http://localhost:7700/health"]'
  do
    echo "$ok" | grep -qE "$pat" \
      && { echo "check-no-hardcoded-dev-stack: port self-test failed — rejects a correct line: $ok"; exit 2; }
  done
  # the e2e half: a bare literal goes red, the env-read fallback stays green. Written as the
  # same two filters the real scan applies, in the same order, so the pair cannot drift apart.
  e2e_hits() { grep -E "$pat" | grep -v 'process\.env' || true; }
  for bad_ts in \
    "const DEFAULT_PUBLIC_URL = 'http://localhost:38127';" \
    'expect(src).toMatch(/localhost(%3A|:)9200/);' \
    "expect(u).toContain('localhost%3A9200');"
  do
    [ -n "$(echo "$bad_ts" | e2e_hits)" ] \
      || { echo "check-no-hardcoded-dev-stack: e2e self-test failed — did not catch: $bad_ts"; exit 2; }
  done
  ok_ts="const B = process.env['APP_BASE_URL'] ?? 'http://localhost:38127';"
  [ -z "$(echo "$ok_ts" | e2e_hits)" ] \
    || { echo "check-no-hardcoded-dev-stack: e2e self-test failed — rejects the env-read form"; exit 2; }
  return 0
}

selftest
selftest_ports
port_violations=$(scan_ports; scan_e2e_ports)
if [ -n "$port_violations" ]; then
  echo "check-no-hardcoded-dev-stack: a host-visible URL names a default port literally —"
  echo "$port_violations" | sed 's/^/  /'
  echo "  This URL is handed to the BROWSER, so it must name the port THIS checkout publishes."
  echo '  Write it as ${DEV_PORT_<KNOB>:-<default>}. If the backend calls it itself, use the'
  echo "  compose service name instead (http://external-mock:9000) — that is not host-visible."
  exit 1
fi
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
nports=$(knob_defaults | wc -l | tr -d ' ')
echo "                              no host-visible URL names any of the $nports knob default port(s) literally"
echo '                              (self-test passed: the literal goes red, the ${KNOB:-default} spelling and a non-knob port stay green).'
