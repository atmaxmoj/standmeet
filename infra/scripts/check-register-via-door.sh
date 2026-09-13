#!/usr/bin/env bash
# check-register-via-door.sh —— plugin registration happens at ONE door.
#
# The plugin registry (internal/plugin/registry) may be called only from the registration door
# (internal/routes/blockload) and from the registry package itself. Anywhere else — above all the
# composition root (cmd/server/blockwire) and the domains — means a block registered itself off the
# door, and "where is a plugin registered?" stops having one answer. This is the structural form of
# "no internal self-registration" (docs/design/plugin/everything-is-a-block.md, rule 2).
#
# Registration verbs scanned: `.MustRegister(`, `.RegisterOrigin(`, and the seam DepRegistry's
# `depReg.Register(`. The bare `.Register(` is deliberately NOT scanned generically —
# periodic.Board.Register and others share the name; the plugin seam registration is always spelled
# `depReg.Register(`.
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
PAT='\.MustRegister\(|\.RegisterOrigin\(|depReg\.Register\('

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
	echo "check-register-via-door: WARN — $rel registers a plugin outside the door (internal/routes/blockload). Move it behind the door."
	fail=1
done < <(printf '%s\n' "$hits")

# WRAP-UP TODO: while the everything-is-a-block migration is in flight this guard is WARN (exit 0) so
# intermediate commits are not blocked. At the final wrap-up, delete this block and restore the
# hard gate:  [ "$fail" -eq 0 ] || exit 1
if [ "$fail" -ne 0 ]; then
	echo "check-register-via-door: (WARN mode — not blocking; flip to error at migration wrap-up)"
	exit 0
fi

echo "check-register-via-door: plugin registration converges on internal/routes/blockload."
