#!/usr/bin/env bash
# check-knobs-reachable.sh —— every knob the product READS must be reachable on the stack we SHIP.
#
# The product is self-hosted: a setting exists for the owner, not for us. `config.go` reading an
# environment variable proves the code can be configured; it proves nothing about whether the person
# who runs `make prod-up` can configure it. Captcha was exactly that — documented as opt-in, read by
# the config, and passed by neither compose file nor named in `.env.example`, so no owner could ever
# turn it on (F-G-2). It had even been "verified" once, by hand-injecting the variable into a running
# container — a path that existed only in the tester's hands.
#
# A knob is reachable when the prod compose passes it (so a value in `.env` arrives) or
# `.env.example` names it (so the owner knows it exists). Anything else must be listed below with a
# reason, in the file, where the next person reads it.
#
# Self-test: `check-knobs-reachable-test.sh` plants an unreachable owner knob and expects red.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONFIG="$ROOT/backend/cmd/server/config/config.go"
COMPOSE="$ROOT/docker-compose.prod.yml"
EXAMPLE="$ROOT/.env.example"

# DEV_ONLY —— knobs that are deliberately unreachable in production, each with the reason.
#
# The `*_BASE_URL` family exists so dev and e2e can point a source at a mock. Production leaving
# them unset is CORRECT: unset means "use the real endpoint". Making them settable would invite an
# owner to repoint their job feeds at something we do not control, for no benefit.
DEV_ONLY='_BASE_URL$'

fail=0
knobs="$(grep -o 'os\.Getenv("[A-Z0-9_]*")' "$CONFIG" | sed 's/.*("//; s/")//' | sort -u)"

# The scan must be able to see something — a config file that stopped matching would otherwise
# report a clean tree (gate-can-go-blind).
count="$(printf '%s\n' "$knobs" | grep -c . || true)"
if [ "$count" -lt 10 ]; then
	echo "check-knobs-reachable: found only $count knobs in config.go — the scan is blind, not the tree clean."
	exit 2
fi

for knob in $knobs; do
	case "$knob" in
	*_BASE_URL) continue ;;
	esac
	if grep -q "$knob" "$COMPOSE" || grep -q "$knob" "$EXAMPLE"; then
		continue
	fi
	echo "check-knobs-reachable: $knob is read by config.go but the shipped prod stack offers no way to set it"
	echo "  → add it to docker-compose.prod.yml's backend environment AND to .env.example,"
	echo "     or add it to DEV_ONLY in this script with the reason it must stay unreachable."
	fail=1
done

if [ "$fail" -ne 0 ]; then
	exit 1
fi
echo "check-knobs-reachable: $count knobs in config.go; every owner-facing one is settable on the prod stack (${DEV_ONLY} exempt by declaration)."
