#!/usr/bin/env bash
# check-no-core-capability-fibers.sh —— the core holds zero Go-implemented capability fibers.
#
# docs/design/layer2-externalize-jobs.md, test plan B. The in-process fiber registry is fed only by
# LOADERS — things that load arbitrary others and name no feature (the skill runner, the ext-MCP
# dialer, the openapi agent tools, the bound-résumé reader). A feature-named owner tool lives as a
# manifest block (backend/blocks/) or a dispatcher fp.Op, never as a Go fiber registered in core.
#
# Two shapes give a capability fiber away, and both are reported:
#   1. the door registers anything but a named loader constructor — `.MustRegister(<x>)` in
#      internal/routes/blockload/ where <x> is not one of LOADERS (the generic door loop
#      `MustRegister(f)` that took a module's fibers is exactly such a call);
#   2. a module hands fibers up — a `[]registry.Fiber{` literal outside internal/plugin/.
# No exclusion list: the loaders are the design's own named set, not grandfathered hits.
set -eu

ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
BK="$ROOT/backend"

LOADERS='newSkillRunnerFiber|NewExtMCPLoader|newOpenapiAgentToolsFiber|newResumeReadFiber'

goFiles() { find "$BK/internal" "$BK/cmd" -type f -name '*.go' ! -name '*_test.go' 2>/dev/null | sort; }

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-no-core-capability-fibers: scanned only $scanned Go files under $BK — blind, not clean." >&2
	exit 2
fi

door="$(goFiles | grep '/internal/routes/blockload/' | xargs grep -nE '\.MustRegister\(' 2>/dev/null || true)"
# The door registers its loaders by construction; finding none means the verb was renamed.
if [ -z "$door" ]; then
	echo "check-no-core-capability-fibers: no MustRegister in the door — blind, not clean." >&2
	exit 2
fi

bad="$( {
	printf '%s\n' "$door" | grep -vE "\.MustRegister\(($LOADERS)\(" || true
	goFiles | grep -v '/internal/plugin/' | xargs grep -nE '\[\]registry\.Fiber\{' 2>/dev/null || true
} )"

if [ -n "$bad" ]; then
	echo "check-no-core-capability-fibers: a capability fiber is registered in core —"
	printf '%s\n' "$bad" | awk -v bk="$BK/" '{ sub(bk, ""); print "  " $0 }'
	echo "  Make the tool a manifest block (backend/blocks/) or a dispatcher fp.Op"
	echo "  (docs/design/layer2-externalize-jobs.md). Only the named loaders register here."
	exit 1
fi
echo "check-no-core-capability-fibers: only loaders are registered in core ($scanned Go files scanned)."
