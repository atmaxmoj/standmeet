#!/usr/bin/env bash
# check-hostops-via-desk.sh —— every host op a sandboxed block can reach must pass through the
# inbound convergence point (backend/internal/routes/hostdesk).
#
# Three rules, all structural:
#
#   1. Only the desk opens a block socket. `hostsocket.ListenWith` may appear in hostdesk (prod)
#      and agentcore (the eval mini-host, which serves the SAME domain-declared ops over plain stdio).
#      Anywhere else — above all the composition root — means a block got a socket the desk's
#      list does not describe, and "what can a sandbox ask the host for?" stops having an answer.
#
#   2. Only a domain (or the block substrate's own mechanism) declares a host op. `hostop.Op{`
#      literals belong in backend/internal/<domain>/{ops,usecase}/ or in the substrate's route
#      packages (blockdesk / supplier). The composition root wires deps; it does not mint verbs.
#
#   3. A manifest orders host ops by NAME, never by path.
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

# --- rule 1: who may open a block socket -------------------------------------------------
LISTEN_ALLOWED='^internal/routes/hostdesk/|^agentcore/'

# listeners —— every file that opens a block socket, plus a self-test.
#
# The pattern used to be spelled `capsocket.ListenWith`. The package was renamed to
# hostsocket, the grep stopped matching anything, and rule 1 went green on an empty scan —
# the same blindness rule 3 had. A scan that finds NOTHING here means the pattern is wrong,
# because the desk and the eval mini-host both call it by construction.
listeners() {
	local found
	found="$(goFiles | xargs grep -l 'hostsocket\.ListenWith' 2>/dev/null | sort)"
	if [ -z "$found" ]; then
		echo "check-hostops-via-desk: SELF-TEST FAILED — nothing calls hostsocket.ListenWith." >&2
		echo "Rule 1 is blind (renamed package?), not satisfied." >&2
		exit 2
	fi
	printf '%s\n' "$found"
}
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$LISTEN_ALLOWED" && continue
	echo "check-hostops-via-desk: $rel calls hostsocket.ListenWith —— only internal/routes/hostdesk may open a block socket (agentcore's eval mini-host is the one other entry point)."
	fail=1
done < <(listeners)

# --- rule 2: who may declare a host op ----------------------------------------------------------
# blockdesk (the block's own storage + config) and supplier (seam reach-back) are the substrate's
# own mechanisms; they were routes/capstore, routes/capconfig and routes/connector before the
# block-vocabulary rename, and the allowlist follows the move rather than being widened.
DECL_ALLOWED='^internal/[a-z0-9]+/(ops|usecase)/|^internal/routes/(blockdesk|supplier)/'
while IFS= read -r f; do
	[ -n "$f" ] || continue
	rel="${f#"$BK"/}"
	echo "$rel" | grep -qE "$DECL_ALLOWED" && continue
	echo "check-hostops-via-desk: $rel builds a hostop.Op —— a host op is declared by the domain that owns it (internal/<domain>/{ops,usecase}) or by the substrate's own mechanism (blockdesk / supplier), never by the assembly root."
	fail=1
done < <(goFiles | grep -v '_test\.go$' | xargs grep -l 'hostop\.Op{' 2>/dev/null | sort)

# --- rule 3: a manifest orders host ops by NAME, never by path ------------------------------------
#
# The manifest package must not carry a HostSockets field: a declaration says WHICH OPS it wants
# (HostOps) and the socket path is derived from the trusted id. (`sandbox.StdioLaunch.HostSockets`
# is a different thing and stays — that is the derived path being handed to bwrap.)
#
# The directory is checked first. This rule used to point at internal/capabilities/mcpplugin, and
# when that package was renamed the `find` simply failed, the `if` went false, and the rule passed
# without ever looking at anything.
MANIFEST_PKG="$BK/internal/plugin"
if [ ! -d "$MANIFEST_PKG" ]; then
	echo "check-hostops-via-desk: $MANIFEST_PKG does not exist — rule 3 is blind, not satisfied." >&2
	exit 2
fi
if find "$MANIFEST_PKG" -maxdepth 1 -name '*.go' -type f -exec grep -l 'HostSockets' {} + >/dev/null 2>&1; then
	echo "check-hostops-via-desk: the manifest package still has a HostSockets field —— a manifest declares WHICH OPS it wants (HostOps), not which files to mount; a path cannot answer 'what is on it'."
	fail=1
fi

[ "$fail" -eq 0 ] || exit 1

echo "check-hostops-via-desk: inbound reach-back converges on internal/routes/hostdesk; domains declare, the root only wires."
