#!/usr/bin/env sh
# check-prod-ports-bound-local —— internal services' published ports may bind only to 127.0.0.1.
#
# **Why this gate exists** (pentest 2026-09-01, the single worst finding of that pass):
# docker's `"5532:5432"` binds **0.0.0.0** by default — every network interface. This box is
# self-hosted and should only be reached through the TLS reverse proxy in front. So the ports for
# db / redis / minio / backend were exposed to the **entire network**.
# redis had no password set: connect to :6479 from outside the app network with no auth, one SCAN
# reads the owner's admin session token (the key name IS the plaintext token), use it as the
# smt_session cookie → **full instance takeover**, zero guessing needed. postgres / minio were
# each one password away from the same thing.
#
# None of these ports need to face outward at all: app connects over the docker internal service
# name, `make prod-psql` / `prod-redis` go through `docker compose exec`. Binding to 127.0.0.1
# keeps host-side debugging while removing the network exposure.
#
# The gate checks one direction: every `ports:` publication for the services below must have
# 127.0.0.1 on the host side (or a `${...}` variable an operator explicitly chose). A bare
# `"NNNN:MMMM"` = 0.0.0.0 → red.

set -eu

COMPOSE="docker-compose.prod.yml"
[ -f "$COMPOSE" ] || { echo "check-prod-ports-bound-local: $COMPOSE is missing; the gate has nothing to check"; exit 2; }

# Internal services: must never be exposed to the network. app is deliberately outward-facing
# (controlled separately by ${APP_BIND_HOST}), so it's excluded here.
INTERNAL="db redis minio backend meilisearch"

# scan —— walk the compose file, track the current service, and for every published port of an
# INTERNAL service, require the host side to be 127.0.0.1 or a ${variable}. Returns violation
# lines (empty = clean).
scan() {
  awk -v internal=" $INTERNAL " '
    /^  [a-zA-Z0-9_-]+:/ {
      svc=$1; sub(/:$/,"",svc); inports=0; next
    }
    /^    ports:/ { inports=(index(internal, " " svc " ")>0); next }
    /^    [a-zA-Z]/ { inports=0 }
    inports && /^      - / {
      line=$0
      # Take the mapping inside the quotes, e.g. "5532:5432" or "127.0.0.1:5532:5432"
      gsub(/[" ]/,"",line); sub(/^-/,"",line)
      # host side = first segment (up to the first colon). Fewer than 2 colons means no host
      # bind was written = 0.0.0.0.
      n=gsub(/:/,":",line)
      hostpart=line; sub(/:.*/,"",hostpart)
      if (n < 2) { print svc " -> " line "  (binds 0.0.0.0 — reachable network-wide)"; next }
      if (hostpart != "127.0.0.1" && hostpart !~ /^\$\{/) {
        print svc " -> " line "  (host bind " hostpart " is not 127.0.0.1)"
      }
    }
  ' "$COMPOSE"
}

# self-test: plant a 0.0.0.0 publication into a temp compose file; it must be caught.
selftest() {
  tmp=$(mktemp)
  printf '  redis:\n    image: r\n    ports:\n      - "6479:6379"\n' > "$tmp"
  hit=$(COMPOSE="$tmp" ; awk -v internal=" redis " '
    /^  [a-zA-Z0-9_-]+:/ { svc=$1; sub(/:$/,"",svc); inports=0; next }
    /^    ports:/ { inports=(index(internal, " " svc " ")>0); next }
    inports && /^      - / { l=$0; gsub(/[" ]/,"",l); sub(/^-/,"",l); if (gsub(/:/,":",l)<2) print "hit" }
  ' "$tmp")
  rm -f "$tmp"
  [ "$hit" = "hit" ] || { echo "check-prod-ports-bound-local: self-test failed to catch the planted 0.0.0.0 binding — the gate is broken"; exit 2; }
}

selftest
violations=$(scan)
if [ -n "$violations" ]; then
  echo "check-prod-ports-bound-local: internal services have ports bound to 0.0.0.0 (reachable network-wide) —"
  echo "$violations" | sed 's/^/  /'
  echo "  change to 127.0.0.1:<host>:<container> (self-hosted should only be reachable via the"
  echo "  TLS reverse proxy; none of these ports need to face outward, app uses the internal"
  echo "  network, prod-psql/redis use exec)."
  exit 1
fi
echo "check-prod-ports-bound-local: internal service ($INTERNAL) published ports are all bound to 127.0.0.1 (self-test passed)."
