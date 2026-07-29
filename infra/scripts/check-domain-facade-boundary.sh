#!/usr/bin/env bash
# check-domain-facade-boundary.sh -- a domain's implementation is reachable ONLY through its facade.
#
# Rule (owner): "a domain must be referenced through its own facade (or the facade dir)". How it
# lands: every domain collects its outward protocol into internal/<domain>/facade/ (a thin layer,
# the whole protocol at a glance) and splits its implementation into sibling guts subpackages
# (entity / usecase / service / repo / db ...). Any package OUTSIDE internal/<domain>/ may import
# ONLY internal/<domain>/facade -- never any other subpackage; those are guts.
#
# Enforcement: a domain OPTS IN the moment it grows an internal/<domain>/facade/ dir. From then on,
# every outside import of internal/<domain>/<sub> where <sub> != facade is a violation. The enforced
# set grows automatically as each domain is converted -- no name-list to maintain.
#
# Exempt: sub-modules that keep their OWN boundary and their own external entry points
# (owner/ownercore is the owner-MCP cap bundle, owner/jobs the job loop, corpus/obsidian the vault
# import/export sub-system, conversation/inference the agent engine) -- none is the domain's guts.
#
# The logic is Go (backend/tools/archcheck): it parses imports with go/parser rather than a regex,
# and cannot fail for want of an interpreter the lint image doesn't carry.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/backend"

go run ./tools/archcheck facade internal

# self-test: plant an outside file importing security's guts (ban), assert it is caught, clean up.
PROBE_DIR=internal/routes/zz_facade_selftest
cleanup() { rm -rf "$PROBE_DIR"; }
trap cleanup EXIT
mkdir -p "$PROBE_DIR"
cat > "$PROBE_DIR/leak.go" <<'GO'
package selftest

import _ "github.com/atmaxmoj/standmeet/internal/security/ban"
GO
if go run ./tools/archcheck facade internal >/dev/null 2>&1; then
	echo "check-domain-facade-boundary: self-test FAILED -- the planted boundary-crossing import was not caught."
	exit 1
fi
cleanup
trap - EXIT
echo "check-domain-facade-boundary: self-test passed (a planted guts import goes red)."
