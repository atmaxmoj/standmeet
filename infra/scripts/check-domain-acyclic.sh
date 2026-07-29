#!/usr/bin/env bash
# check-domain-acyclic.sh -- backend/internal/ **domain-level dependency graph must be acyclic**.
#
# go-arch-lint only enforces **package-level** acyclicity (Go won't compile a cycle anyway). But
# treating each internal/<top-dir>/** as **one node**, sub-packages can split a domain-level cycle
# into a package-level DAG -- slipping past go-arch-lint. This gate treats each domain (and each
# own-boundary sub-module) as a node, builds the inter-domain import graph, and is red on a cycle.
#
# Each domain should be a clean node (able to get a thin facade); a domain-level cycle = layering
# not sorted out, break the cycle first.
#
# The logic is Go (backend/tools/archcheck): it parses imports with go/parser rather than a regex,
# and cannot fail for want of an interpreter the lint image doesn't carry. This wrapper adds the
# self-test that proves the gate actually bites.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/backend"

go run ./tools/archcheck acyclic internal

# self-test: plant a REAL core-to-core cycle -- owner/usecase importing conversation's facade, while
# conversation already imports owner -- and assert it goes red. Then remove it.
PROBE=internal/owner/usecase/zz_acyclic_selftest.go
cleanup() { rm -f "$PROBE"; }
trap cleanup EXIT
cat > "$PROBE" <<'GO'
package usecase

import _ "github.com/atmaxmoj/standmeet/internal/conversation/facade"
GO
if go run ./tools/archcheck acyclic internal >/dev/null 2>&1; then
	echo "check-domain-acyclic: self-test FAILED -- the planted core-to-core cycle was not caught."
	exit 1
fi
cleanup
trap - EXIT
echo "check-domain-acyclic: self-test passed (a planted core-to-core cycle goes red)."
