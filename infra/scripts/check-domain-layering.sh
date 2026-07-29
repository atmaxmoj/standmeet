#!/usr/bin/env bash
# check-domain-layering.sh -- lock the DDD-layer order INSIDE each faceted domain.
#
# Rule (owner): the intra-domain dependency chain must be lint-locked. Guts must not
# back-reference the facade; a lower layer must not reach up. Layer order (low -> high):
#
#     entity / db / infra   (0, leaves)  <  repo (1)  <  service (2)  <  usecase (3)  <  facade (4)
#
# A file in layer L may import a sibling subpackage of the SAME domain only from a strictly
# LOWER layer. Same-level or higher = violation. So: entity imports no sibling; repo -> entity
# only; service -> entity/repo; usecase -> entity/repo/service; facade -> anything; nobody
# imports facade. "infra is infra": infra sits at level 0 and pulls nothing up.
#
# go-arch-lint's per-component mayDependOn already enforces this; this lint states the invariant
# as one legible rule, self-tests that it bites, and covers every faceted domain uniformly.
# Non-DDD sub-packages (jobs, search, contract, ...) keep their own boundary, not layered here.
#
# The logic is Go (backend/tools/archcheck): it parses imports with go/parser rather than a regex,
# and cannot fail for want of an interpreter the lint image doesn't carry.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/backend"

go run ./tools/archcheck layering internal

# self-test: plant an entity file importing its own repo (a reverse edge), assert caught, clean up.
ENTITY=internal/security/entity
REPO=internal/security/repo
cleanup() {
	rm -f "$ENTITY/zz_layering_selftest.go" "$REPO/zz_layering_selftest.go"
	rmdir "$REPO" 2>/dev/null || true
	rmdir "$ENTITY" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$ENTITY" "$REPO" # security has neither layer today, so plant both ends
cat > "$ENTITY/zz_layering_selftest.go" <<'GO'
package entity

import _ "github.com/atmaxmoj/standmeet/internal/security/repo"
GO
cat > "$REPO/zz_layering_selftest.go" <<'GO'
package repo
GO
if go run ./tools/archcheck layering internal >/dev/null 2>&1; then
	echo "check-domain-layering: self-test FAILED -- planted reverse layer edge was not caught."
	exit 1
fi
cleanup
trap - EXIT
echo "check-domain-layering: self-test passed (a planted reverse layer edge goes red)."
