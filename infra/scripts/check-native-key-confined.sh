#!/usr/bin/env bash
# check-native-key-confined.sh —— the native key is unwrapped at ONE boundary.
#
# nativekey.Key redacts itself on every value-escaping channel, so the TYPE may travel freely
# (Deps structs, mount wiring, closures). What must not travel is the unwrap: `.Reveal()` returns
# the real credential, and it may be called only at the reach-back auth boundary — the place that
# hands the secret to Postgres / the host socket and nowhere else. A `.Reveal()` in a response
# builder, a log line, or a serializer is the leak this type exists to prevent
# (docs/design/plugin/everything-is-a-block.md, rule 4).
#
# The guard scans non-test Go files that IMPORT internal/plugin/nativekey for a `.Reveal(` call, and
# fails any outside the allowed auth-boundary set. Precise by construction: a file that both imports
# nativekey and calls .Reveal( is unwrapping a native key; an unrelated Reveal() on some other type
# is not matched because its file does not import nativekey.
#
# Modeled on check-core-seals-only: correctness rests on the plant-a-violation self-test below, not on
# finding a legitimate caller (there is none until the db bridge lands — the type is new). Baseline
# (.native-key-confined-baseline) grandfathers pre-existing call-sites and only ever shrinks.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
BASELINE="$BK/.native-key-confined-baseline"

# find, not `grep --include`: BusyBox grep (alpine image lint) does not know that flag and exits 2
# with no output, which reads exactly like a clean tree.
goFiles() { find "$BK/internal" "$BK/cmd" -type f -name '*.go' 2>/dev/null | sort; }

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-native-key-confined: scanned only $scanned Go files under $BK — the scan is blind, not the tree clean." >&2
	exit 2
fi

# ALLOWED —— the reach-back auth boundary: the only places that may unwrap a native key. Two halves:
# the issuer itself, and the mint→deliver point that hands the freshly-issued key into the block's
# own confined sandbox env (mount/dial.go). The db bridge / host-socket verify land here as built.
# This is the auth boundary's definition, not a debt carve-out — Reveal() is legitimate only here.
ALLOWED='^internal/plugin/nativekey/|^internal/plugin/mount/dial\.go$'
IMPORT='atmaxmoj/standmeet/internal/plugin/nativekey'

# offenders —— files that import nativekey AND call .Reveal(, outside ALLOWED, not baselined.
offenders() {
	while IFS= read -r f; do
		[ -n "$f" ] || continue
		grep -q "$IMPORT" "$f" 2>/dev/null || continue
		grep -q '\.Reveal(' "$f" 2>/dev/null || continue
		rel="${f#"$BK"/}"
		echo "$rel" | grep -qE "$ALLOWED" && continue
		if [ -f "$BASELINE" ] && grep -qxF "$rel" "$BASELINE"; then continue; fi
		printf '%s\n' "$rel"
	done < <(goFiles | grep -v '_test\.go$')
}

selftest() {
	# Plant a forbidden unwrap in a serializer-like package; assert the guard names it.
	local dir="$BK/internal/conversation/planted_nativekey_leak_$$"
	mkdir -p "$dir"
	cat >"$dir/leak.go" <<GO
package planted
import nk "github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
func Leak(k nk.Key) string { return k.Reveal() }
GO
	local rel="internal/conversation/planted_nativekey_leak_$$/leak.go"
	local caught=0
	offenders | grep -qxF "$rel" && caught=1
	rm -rf "$dir"
	[ "$caught" -eq 1 ]
}

if ! selftest; then
	echo "check-native-key-confined: SELF-TEST FAILED — a planted .Reveal() in a serializer package was not caught. Guard is blind." >&2
	exit 2
fi

fail=0
while IFS= read -r rel; do
	[ -n "$rel" ] || continue
	echo "check-native-key-confined: $rel unwraps a native key (.Reveal()) outside the auth boundary. Confine it."
	fail=1
done < <(offenders)

# ERROR mode (flipped from WARN at the everything-is-a-block wrap-up): an unwrap outside the auth
# boundary blocks the commit. The baseline above still grandfathers pre-existing call-sites.
[ "$fail" -eq 0 ] || exit 1

echo "check-native-key-confined: native-key unwrap (.Reveal()) stays at the auth boundary (self-test passed)."
