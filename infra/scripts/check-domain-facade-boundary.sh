#!/usr/bin/env bash
# check-domain-facade-boundary.sh -- a domain's implementation is reachable ONLY through its facade.
#
# Rule (owner): "a domain must be referenced through its own facade (or the facade dir)". How it lands:
# every domain collects its outward protocol into internal/<domain>/facade/ (a thin layer, the whole
# protocol at a glance) and splits its implementation into sibling guts subpackages (entity / usecase /
# service / repo / db ...). Any package OUTSIDE internal/<domain>/ may import ONLY
# internal/<domain>/facade -- never any other subpackage; those are guts.
#
# Enforcement: a domain OPTS IN the moment it grows an internal/<domain>/facade/ dir. From then on,
# every outside import of internal/<domain>/<sub> where <sub> != facade is a violation. The enforced
# set grows automatically as each domain is converted -- no name-list to maintain.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"

scan() {
  local internal="$1"
  python3 - "$internal" <<'PY'
import os, re, sys
internal = sys.argv[1]
# Opted-in domains = those that have an internal/<domain>/facade/ subdirectory.
domains = sorted(
    d for d in os.listdir(internal)
    if os.path.isdir(os.path.join(internal, d, "facade"))
)
imp_re = re.compile(r'atmaxmoj/standmeet/internal/([a-z0-9_]+)/([a-z0-9_]+)')
violations = []
for d in domains:
    domain_root = os.path.join(internal, d) + os.sep
    for dirpath, _, files in os.walk(internal):
        # A domain referencing its own subpackages is fine (facade lives here and imports guts).
        if (dirpath + os.sep).startswith(domain_root):
            continue
        for fn in files:
            if not fn.endswith(".go"):
                continue
            path = os.path.join(dirpath, fn)
            for line in open(path):
                for dom, sub in imp_re.findall(line):
                    if dom == d and sub != "facade":
                        rel = os.path.relpath(path, internal)
                        violations.append(f"{rel}\t{d}/{sub}")
for v in sorted(set(violations)):
    print(v)
PY
}

hits="$(scan "$INTERNAL")"
if [ -n "$hits" ]; then
  echo "check-domain-facade-boundary: outside code bypasses the facade and imports a domain's guts:"
  echo "$hits" | while IFS=$'\t' read -r f gut; do
    echo "  $f  -> internal/$gut  (must go through .../facade)"
  done
  exit 1
fi

# self-test: plant an outside file that imports security's guts (ban), assert it is caught, clean up.
TMPDIR="$INTERNAL/__facade_boundary_selftest__"
mkdir -p "$TMPDIR"
cat > "$TMPDIR/leak.go" <<'GO'
package selftest

import _ "github.com/atmaxmoj/standmeet/internal/security/ban"
GO
planted="$(scan "$INTERNAL")"
rm -rf "$TMPDIR"
if [ -z "$planted" ]; then
  echo "check-domain-facade-boundary: self-test FAILED -- the planted boundary-crossing import was not caught."
  exit 1
fi

enforced="$(python3 -c "import os;print(len([d for d in os.listdir('$INTERNAL') if os.path.isdir(os.path.join('$INTERNAL',d,'facade'))]))")"
echo "check-domain-facade-boundary: $enforced domain(s) have a facade; outside code reaches them only via .../facade (self-test passed)."
