#!/usr/bin/env bash
# check-blocks-declare-in-data.sh —— every built-in block declares itself as DATA, in its own
# directory, and the composition root only assembles.
#
#   backend/blocks/<id>/manifest.yaml  — one directory per block
#
# A block that supplies a seam and a block that only consumes one live in the SAME tree; what
# separates them is a field (`provides`), not a directory. This gate used to be
# check-axes-declare-in-data.sh and scanned two trees — backend/capabilities/ and
# backend/connectors/ — which no longer exist. It is renamed and re-pointed here rather than
# left aiming at empty paths.
#
# The manifests used to be Go literals inside cmd/server: a block's identity, which host ops it
# orders, which field it occupies on an invite code, its config defaults — all written where the
# program is WIRED rather than where the block is DESCRIBED. Adding one meant editing the
# assembly root, and the root grew a copy of every block's shape.
#
# Rules:
#
#   1. No `plugin.Manifest{` literal outside the loader. Building one in the root is exactly the
#      thing the data directory replaced.
#   2. No socket path in a declaration. `host_ops` names WHAT a block wants; the path is derived
#      from the trusted id. A manifest that names a file cannot answer "what is on it" — that is
#      why the host used to need four hand-written gateways.
#   3. The tree exists with at least one declared member, so "no manifests found" cannot read as
#      pass.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
# Allowed to build a Manifest: the block data package's own loader, the mount machinery, and
# agentcore — the eval mini-host, whose entire job is turning a Driver's PluginSpec into a
# manifest. None of them DECLARE a built-in; they translate one shape into another.
LOADER_ALLOWED='^blocks/|^internal/plugin/|^internal/routes/blockload/|^agentcore/'

fail=0

# --- rule 3 first: the scan must be able to see something -----------------------------------------
blocks="$(find "$BK/blocks" -mindepth 2 -maxdepth 2 -name manifest.yaml 2>/dev/null | wc -l | tr -d ' ')"
if [ "$blocks" -lt 1 ]; then
	echo "check-blocks-declare-in-data: found $blocks block manifests — the scan is blind, not the tree clean."
	exit 2
fi

# --- rule 1: who may build a Manifest -------------------------------------------------------------
#
# `[]plugin.Manifest{x}` is a SLICE of manifests already built elsewhere — passing one along, not
# describing one — so the pattern excludes it. Without that exclusion the gate reddens on
# `ms := []plugin.Manifest{*m}`, which is the opposite of the thing being banned.
goFiles() {
	find "$BK/internal" "$BK/cmd" "$BK/agentcore" "$BK/blocks" -type f -name '*.go' 2>/dev/null |
		grep -v '_test\.go$' | sort
}
declarers() {
	goFiles | xargs grep -lE '(^|[^]])plugin\.Manifest\{' 2>/dev/null | sort
}
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$LOADER_ALLOWED" && continue
	echo "check-blocks-declare-in-data: $rel builds a plugin.Manifest —— a built-in block is DECLARED in backend/blocks/<id>/manifest.yaml; the assembly root assembles, it does not describe."
	fail=1
done < <(declarers)

# --- rule 2: no paths in the declarations ---------------------------------------------------------
while IFS= read -r m; do
	[ -n "$m" ] || continue
	if grep -qE '(_SOCKET|/run/standmeet|\.sock)' "$m" 2>/dev/null; then
		echo "check-blocks-declare-in-data: ${m#"$BK"/} names a socket path —— a declaration says WHICH OPS it wants; the path is derived from the id."
		fail=1
	fi
done < <(find "$BK/blocks" -mindepth 2 -maxdepth 2 -name manifest.yaml 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1

echo "check-blocks-declare-in-data: blocks declare in data ($blocks manifests); no paths in the declarations."
