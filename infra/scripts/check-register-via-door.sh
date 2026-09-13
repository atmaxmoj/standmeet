#!/usr/bin/env bash
# check-register-via-door.sh —— plugin registration happens at ONE door.
#
# The plugin registry (internal/plugin/registry) may be called only from the registration door
# (internal/routes/blockload) and from the registry package itself. Anywhere else — above all the
# composition root (cmd/server/blockwire) and the domains — means a block registered itself off the
# door, and "where is a plugin registered?" stops having one answer. This is the structural form of
# "no internal self-registration" (docs/design/plugin/everything-is-a-block.md, rule 2).
#
# Registration verbs scanned: the block/fiber registry's `.MustRegister(` and `.RegisterOrigin(`.
# The bare `.Register(` is NOT scanned (periodic.Board.Register etc. share the name), and the seam
# DepRegistry's `depReg.Register(` is deliberately EXCLUDED: registering which supplier provides a
# seam is composition-root **wiring**, not a block minting itself — the same distinction
# check-hostops-via-desk draws ("the assembly root wires deps, it never mints verbs"). This gate is
# about who registers a BLOCK/FIBER; that must be the door.
#
# Baseline (.register-via-door-baseline) grandfathers pre-existing call-sites and only ever shrinks.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
BASELINE="$BK/.register-via-door-baseline"

# goFiles —— find, not `grep --include`: BusyBox grep (alpine image lint) does not know that flag and
# exits 2 with no output, which reads exactly like a clean tree.
goFiles() { find "$BK/internal" "$BK/cmd" -type f -name '*.go' 2>/dev/null | sort; }

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-register-via-door: scanned only $scanned Go files under $BK — the scan is blind, not the tree clean."
	exit 2
fi

# The door is internal/routes/blockload. internal/plugin/ is the substrate that PROVIDES the
# registration mechanism (registry, mount): the door invokes it. Violations are domains and the
# composition root (cmd/server/blockwire, internal/owner/...) registering directly.
ALLOWED='^internal/routes/blockload/|^internal/plugin/'
PAT='\.MustRegister\(|\.RegisterOrigin\('

# blind-check: the door registers by construction, so the pattern MUST find at least one file. Nothing
# found means the verbs were renamed and the gate went blind, which must go RED, not green.
hits="$(goFiles | grep -v '_test\.go$' | xargs grep -lE "$PAT" 2>/dev/null | sort)"
if [ -z "$hits" ]; then
	echo "check-register-via-door: SELF-TEST FAILED — nothing calls the registry (renamed verbs?). Blind, not satisfied." >&2
	exit 2
fi

fail=0
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	if [ -f "$BASELINE" ] && grep -qxF "$rel" "$BASELINE"; then continue; fi
	echo "check-register-via-door: $rel registers a plugin outside the door (internal/routes/blockload). Move it behind the door."
	fail=1
done < <(printf '%s\n' "$hits")

# ERROR mode (flipped from WARN at the everything-is-a-block wrap-up): registration outside the door
# blocks the commit. The baseline above still grandfathers pre-existing call-sites and only shrinks.
[ "$fail" -eq 0 ] || exit 1

echo "check-register-via-door: plugin registration converges on internal/routes/blockload."
