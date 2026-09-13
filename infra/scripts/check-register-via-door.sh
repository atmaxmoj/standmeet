#!/usr/bin/env bash
# check-register-via-door.sh —— plugin registration happens at ONE door.
#
# The plugin registry (internal/plugin/registry) may be called only from the registration door
# (internal/routes/blockload) and from the registry package itself. Anywhere else — above all the
# composition root (cmd/server/blockwire) and the domains — means a block registered itself off the
# door, and "where is a plugin registered?" stops having one answer. This is the structural form of
# "no internal self-registration" (docs/design/plugin/everything-is-a-block.md, rule 2).
#
# ONE reference chain, facade→core: registration reaches the core only through the door. There is no
# second path. The reified supplier layer + seam wiring in the composition root
# (`adapters.NewSuppliers(`, `depReg.Register(`) IS that forbidden second path — the
# everything-is-a-block target folds it into the door so db/warn/suppliers register as blocks like
# everything else. It is NOT excused as "wiring": that carve-out is exactly how bespoke host Go
# (blockstore/blockwarn/caldav) slipped in unseen. No exclusion list — every hit is reported.
#
# The block/fiber verbs (`.MustRegister(` / `.RegisterOrigin(`) are ERROR now (already converged on
# the door). The second-path verbs are surfaced as WARNINGS — the debt to burn down — and flip to
# ERROR once the fold lands (docs/design/plugin/everything-is-a-block.md wrap-up: warning→error).
# The bare `.Register(` is not scanned by name alone (periodic.Board.Register etc. share it); the
# seam registry is caught by its own receiver `depReg.Register(`.
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

# Second registration path (the reified supplier layer + seam wiring) — WARNING while the fold into
# the door is in flight. No exclusion list: every hit outside the door is printed; the count must
# reach zero, then these verbs join the ERROR set above and this block is deleted.
SECOND_PATH='adapters\.NewSuppliers\(|depReg\.Register\('
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-register-via-door: WARNING — $rel registers via the second path (supplier layer / seam wiring), not the door. Fold it into blockload (everything-is-a-block: one reference chain)."
done < <(goFiles | grep -v '_test\.go$' | xargs grep -lE "$SECOND_PATH" 2>/dev/null | sort)

echo "check-register-via-door: plugin registration converges on internal/routes/blockload."
