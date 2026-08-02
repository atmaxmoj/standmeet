#!/usr/bin/env bash
# check-hostops-via-desk.sh —— every host op a sandboxed capability can reach must pass through the
# inbound convergence point (backend/internal/routes/hostdesk).
#
# Two rules, both structural:
#
#   1. Only the desk opens a capability socket. `capsocket.ListenWith` may appear in hostdesk (prod)
#      and agentcore (the eval mini-host, which serves the SAME domain-declared ops over plain stdio).
#      Anywhere else — above all the composition root — means a capability got a socket the desk's
#      list does not describe, and "what can a sandbox ask the host for?" stops having an answer.
#
#   2. Only a domain (or an axis's own mechanism) declares a host op. `hostop.Op{` literals belong in
#      backend/internal/<domain>/{ops,usecase}/ or in the two axes' route packages
#      (capstore / capconfig / connector). The composition root wires deps; it does not mint verbs.
#
# This is the inbound mirror of check-routes-via-dispatcher. It has no baseline: the desk landed with
# the last hand-written gateway deleted, so there is nothing left to grandfather.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"

# goFiles —— the Go files to scan. NOT `grep --include`: the image lint runs on alpine, whose
# BusyBox grep does not know that flag — it exits 2 with no output, and a scan that finds nothing
# reads exactly like a tree with no violations. `find` behaves the same everywhere.
goFiles() {
	find "$BK/internal" "$BK/cmd" "$BK/agentcore" -type f -name '*.go' 2>/dev/null | sort
}

# scanned —— proof the scan can see the tree at all. If this ever comes back empty the gate is
# blind, and a blind gate must go RED, not green (that is how the BusyBox flag hid for one build).
scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-hostops-via-desk: scanned only $scanned Go files under $BK — the scan is blind, not the tree clean."
	exit 2
fi

fail=0

# --- rule 1: who may open a capability socket -------------------------------------------------
LISTEN_ALLOWED='^internal/routes/hostdesk/|^agentcore/'
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$LISTEN_ALLOWED" && continue
	echo "check-hostops-via-desk: $rel calls capsocket.ListenWith —— only internal/routes/hostdesk may open a capability socket (agentcore's eval mini-host is the one other entry point)."
	fail=1
done < <(goFiles | xargs grep -l 'capsocket\.ListenWith' 2>/dev/null | sort)

# --- rule 2: who may declare a host op ----------------------------------------------------------
DECL_ALLOWED='^internal/[a-z0-9]+/(ops|usecase)/|^internal/routes/(capstore|capconfig|connector)/'
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$DECL_ALLOWED" && continue
	echo "check-hostops-via-desk: $rel builds a hostop.Op —— a host op is declared by the domain that owns it (internal/<domain>/{ops,usecase}) or by an axis's own mechanism (capstore / capconfig / connector), never by the assembly root."
	fail=1
done < <(goFiles | grep -v '_test\.go$' | xargs grep -l 'hostop\.Op{' 2>/dev/null | sort)

# --- rule 3: a manifest orders host ops by NAME, never by path ------------------------------------
if find "$BK/internal/capabilities/mcpplugin" -name '*.go' -type f -exec grep -l 'HostSockets' {} + >/dev/null 2>&1; then
	echo "check-hostops-via-desk: mcpplugin still has a HostSockets field —— a manifest declares WHICH OPS it wants (HostOps), not which files to mount; a path cannot answer 'what is on it'."
	fail=1
fi

[ "$fail" -eq 0 ] || exit 1

echo "check-hostops-via-desk: inbound reach-back converges on internal/routes/hostdesk; domains declare, the root only wires."
