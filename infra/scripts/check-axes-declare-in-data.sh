#!/usr/bin/env bash
# check-axes-declare-in-data.sh —— both plugin axes declare their built-ins as DATA, in their own
# top-level directory, and the composition root only assembles.
#
#   backend/connectors/<id>/manifest.yaml    — the connector axis
#   backend/capabilities/<id>/manifest.yaml  — the capability axis
#
# The capability manifests used to be Go literals inside cmd/server: a capability's identity, which
# host ops it orders, which field it occupies on an invite code, its config defaults — all written
# where the program is WIRED rather than where the capability is DESCRIBED. Adding one meant editing
# the assembly root, and the root grew a copy of every capability's shape.
#
# Rules:
#
#   1. No `mcpplugin.Manifest{` literal outside the loader. Building one in the root is exactly the
#      thing the data directory replaced.
#   2. No socket path in a declaration. `host_ops` names WHAT a capability wants; the path is derived
#      from the trusted id. A manifest that names a file cannot answer "what is on it" — that is why
#      the host used to need four hand-written gateways.
#   3. Both axes exist with at least one declared member, so "no manifests found" cannot read as pass.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
# Allowed to build a Manifest: the built-in loader, the manifest type's own package, the third-party
# parser, and agentcore — the eval mini-host, whose entire job is turning a Driver's PluginSpec into
# a manifest. None of them DECLARE a built-in; they translate one shape into another.
LOADER_ALLOWED='^capabilities/|^internal/capabilities/mcpplugin/|^internal/routes/capload/|^agentcore/'

fail=0

# --- rule 3 first: the scan must be able to see something -----------------------------------------
caps="$(find "$BK/capabilities" -mindepth 2 -maxdepth 2 -name manifest.yaml 2>/dev/null | wc -l | tr -d ' ')"
conns="$(find "$BK/connectors" -mindepth 2 -maxdepth 2 -name manifest.yaml 2>/dev/null | wc -l | tr -d ' ')"
if [ "$caps" -lt 1 ] || [ "$conns" -lt 1 ]; then
	echo "check-axes-declare-in-data: found $caps capability and $conns connector manifests — the scan is blind, not the tree clean."
	exit 2
fi

# --- rule 1: who may build a Manifest -------------------------------------------------------------
goFiles() {
	find "$BK/internal" "$BK/cmd" "$BK/agentcore" "$BK/capabilities" -type f -name '*.go' 2>/dev/null |
		grep -v '_test\.go$' | sort
}
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$LOADER_ALLOWED" && continue
	echo "check-axes-declare-in-data: $rel builds an mcpplugin.Manifest —— a built-in capability is DECLARED in backend/capabilities/<id>/manifest.yaml; the assembly root assembles, it does not describe."
	fail=1
done < <(goFiles | xargs grep -l 'mcpplugin\.Manifest{' 2>/dev/null | sort)

# --- rule 2: no paths in the declarations ---------------------------------------------------------
while IFS= read -r m; do
	[ -n "$m" ] || continue
	if grep -qE '(_SOCKET|/run/standmeet|\.sock)' "$m" 2>/dev/null; then
		echo "check-axes-declare-in-data: ${m#"$BK"/} names a socket path —— a declaration says WHICH OPS it wants; the path is derived from the id."
		fail=1
	fi
done < <(find "$BK/capabilities" -mindepth 2 -maxdepth 2 -name manifest.yaml 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1

echo "check-axes-declare-in-data: both axes declare in data ($caps capabilities, $conns connectors); no paths in the declarations."
