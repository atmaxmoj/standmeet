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
# as one legible rule, self-tests that it bites, and covers the layering for every faceted domain
# uniformly. Non-DDD sub-packages (jobs, search, contract, …) keep their own boundary and are
# not layered here.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

scan() {
  local internal="$1"
  python3 - "$internal" <<'PY'
import os, re, sys
internal = sys.argv[1]
LEVEL = {"entity": 0, "db": 0, "infra": 0, "repo": 1, "service": 2, "usecase": 3, "facade": 4}
domains = sorted(
    d for d in os.listdir(internal)
    if os.path.isdir(os.path.join(internal, d, "facade"))
)
imp_re = re.compile(r'atmaxmoj/standmeet/internal/([a-z0-9_]+)/([a-z0-9_]+)')
violations = []
for d in domains:
    for layer, lvl in LEVEL.items():
        ldir = os.path.join(internal, d, layer)
        if not os.path.isdir(ldir):
            continue
        for dirpath, _, files in os.walk(ldir):
            for fn in files:
                if not fn.endswith(".go"):
                    continue
                for line in open(os.path.join(dirpath, fn)):
                    for dom, sub in imp_re.findall(line):
                        if dom == d and sub in LEVEL and LEVEL[sub] >= lvl and sub != layer:
                            violations.append(f"{d}/{layer}\t{d}/{sub}")
for v in sorted(set(violations)):
    print(v)
PY
}

hits="$(scan "$INTERNAL")"
if [ -n "$hits" ]; then
  echo "check-domain-layering: a domain's DDD layer reaches sideways/up (must only import lower layers):"
  echo "$hits" | while IFS=$'\t' read -r from to; do
    echo "  internal/$from  ->  internal/$to  (illegal layer direction)"
  done
  exit 1
fi

# self-test: plant an entity file importing its own repo (reverse edge), assert caught, clean up.
TMP="$INTERNAL/security/entity"
mkdir -p "$TMP"
cat > "$TMP/__layering_selftest__.go" <<'GO'
package entity

import _ "github.com/atmaxmoj/standmeet/internal/security/repo"
GO
# security has no repo/ layer, so plant the target too
mkdir -p "$INTERNAL/security/repo"
cat > "$INTERNAL/security/repo/__layering_selftest__.go" <<'GO'
package repo
GO
planted="$(scan "$INTERNAL")"
rm -f "$TMP/__layering_selftest__.go" "$INTERNAL/security/repo/__layering_selftest__.go"
rmdir "$INTERNAL/security/repo" 2>/dev/null || true
rmdir "$TMP" 2>/dev/null || true
if [ -z "$planted" ]; then
  echo "check-domain-layering: self-test FAILED -- planted reverse layer edge was not caught."
  exit 1
fi

echo "check-domain-layering: DDD layer order holds in every faceted domain (self-test passed)."
