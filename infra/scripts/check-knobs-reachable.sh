#!/usr/bin/env bash
# check-knobs-reachable.sh —— every knob the product READS must be reachable on the stack we SHIP.
#
# The product is self-hosted: a setting exists for the owner, not for us. Code reading an
# environment variable proves the code can be configured; it proves nothing about whether the person
# who runs `make prod-up` can configure it. Captcha was exactly that — documented as opt-in, read by
# the config, and passed by neither compose file nor named in `.env.example`, so no owner could ever
# turn it on (F-G-2). It had even been "verified" once, by hand-injecting the variable into a running
# container — a path that existed only in the tester's hands.
#
# A knob is reachable when the prod compose passes it (so a value in `.env` arrives) or
# `.env.example` names it (so the owner knows it exists). Anything else must be exempt below with a
# reason, in the file, where the next person reads it.
#
# **Scans the whole backend, not just config.go** (F-C-49). It used to read `config.go` alone while
# its first line claimed "every knob the product READS". `CONNECTOR_EGRESS_ALLOW` is read in
# `axisconn/register.go` and passed by the dev compose only — so on a shipped prod stack a connector
# could never reach a self-hosted service, and this gate reported green the whole time. It was
# telling the truth about what it looked at, which reads as the truth about the tree.
#
# Self-test: `check-knobs-reachable-test.sh` plants an unreachable knob in config.go AND outside it,
# and expects red for both.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND="$ROOT/backend"
COMPOSE="$ROOT/docker-compose.prod.yml"
EXAMPLE="$ROOT/.env.example"

# is_exempt —— knobs deliberately unreachable in production, each with the reason.
#
#   *_BASE_URL              dev and e2e point a source at a mock. Production leaving them unset is
#                           CORRECT: unset means "use the real endpoint". Making them settable would
#                           invite an owner to repoint their job feeds at something we do not
#                           control, for no benefit.
#   AGENT_TURN_TIMEOUT      both are there so e2e can shorten the budgets and force the
#   FORCE_FINAL_TIMEOUT     past-the-boundary path — `agent_loop_budget.go:272` says so in as many
#                           words. An owner shortening them would only cut their own turns short.
#   SANDBOX_WORKSPACE_ROOT  a path inside the container with a working default; moving it means
#                           changing the image's mounts too, so it is not a setting on its own.
#   STANDMEET_UPGRADE_SIGNAL the product-owned upgrade path. It's wired by the image-based deploy
#                           compose (infra/deploy/docker-compose.yml) TOGETHER with the updater
#                           sidecar — the two only make sense as a pair. The source-build
#                           docker-compose.prod.yml upgrades by git-pull + rebuild, ships no
#                           updater, so leaving this unset there is CORRECT (the button falls back
#                           to STANDMEET_REDEPLOY_HOOK, or honestly reports it can't act).
is_exempt() {
	case "$1" in
	*_BASE_URL | AGENT_TURN_TIMEOUT | FORCE_FINAL_TIMEOUT | SANDBOX_WORKSPACE_ROOT) return 0 ;;
	STANDMEET_UPGRADE_SIGNAL) return 0 ;;
	esac
	return 1
}

fail=0
knobs="$(grep -rho 'os\.Getenv("[A-Z0-9_]*")' --include='*.go' --exclude='*_test.go' "$BACKEND" |
	sed 's/.*("//; s/")//' | sort -u)"

# The scan must be able to see something — a tree that stopped matching would otherwise
# report clean (gate-can-go-blind).
count="$(printf '%s\n' "$knobs" | grep -c . || true)"
if [ "$count" -lt 20 ]; then
	echo "check-knobs-reachable: found only $count knobs in backend/ — the scan is blind, not the tree clean."
	exit 2
fi

for knob in $knobs; do
	if is_exempt "$knob"; then
		continue
	fi
	if grep -q "$knob" "$COMPOSE" || grep -q "$knob" "$EXAMPLE"; then
		continue
	fi
	echo "check-knobs-reachable: $knob is read by the backend but the shipped prod stack offers no way to set it"
	echo "  → add it to docker-compose.prod.yml's backend environment AND to .env.example,"
	echo "     or add it to is_exempt in this script with the reason it must stay unreachable."
	fail=1
done

if [ "$fail" -ne 0 ]; then
	exit 1
fi
echo "check-knobs-reachable: $count knobs read across backend/; every owner-facing one is settable on the prod stack (exemptions declared in this script)."
