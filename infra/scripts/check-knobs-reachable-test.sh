#!/usr/bin/env bash
# check-knobs-reachable-test.sh —— the gate must go red on the defect it exists for.
#
# Plants an owner-facing knob that nothing on the prod stack can set (exactly F-G-2's shape) and
# expects a non-zero exit. A gate nobody has watched fail is a gate that might be scanning nothing
# (gate-can-go-blind).
#
# TWO plants, because the gate has been blind once already in a way its own green line hid
# (F-C-49). It scanned `config.go` alone while its stated job is "every knob the product READS":
# `CONNECTOR_EGRESS_ALLOW` is read in `axisconn/register.go`, is passed by the dev compose only,
# and so no owner on a shipped prod stack could ever let a connector reach a self-hosted service.
# The gate stayed green the whole time — it was telling the truth about what it looked at, which
# read as the truth about the tree. So the second plant lives OUTSIDE config.go on purpose.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/infra/scripts/check-knobs-reachable.sh"

# plant_expect_red —— append an unreachable knob to a real source file, run the gate, restore.
# The knob is not a *_BASE_URL, so the declared exemption does not cover it.
plant_expect_red() {
	file="$1"
	where="$2"
	knob="$3"
	backup="$(mktemp)"
	cp "$file" "$backup"
	printf '\n// planted by check-knobs-reachable-test.sh\nvar _ = os.Getenv("%s")\n' \
		"$knob" >> "$file"
	if "$GATE" >/dev/null 2>&1; then
		cp "$backup" "$file"
		rm -f "$backup"
		echo "check-knobs-reachable self-test FAILED: an unreachable owner knob in $where passed the gate"
		exit 1
	fi
	cp "$backup" "$file"
	rm -f "$backup"
}

plant_expect_red "$ROOT/backend/cmd/server/config/config.go" "config.go" "PLANTED_OWNER_KNOB"
# 第二处：**不在 config.go 里**。真实的那一次就是这么漏掉的。
plant_expect_red "$ROOT/backend/internal/connector/egress.go" "a file outside config.go" \
	"PLANTED_OWNER_KNOB_ELSEWHERE"

echo "✓ check-knobs-reachable self-test passed (an unreachable knob goes red, in config.go and outside it)"
