#!/usr/bin/env bash
# check-supplier-boundary.sh —— structure gate: credentials never leave the vault (go-arch level).
#
# `internal/plugin/credentials` holds the owner's decrypted connection state — tokens, SMTP
# passwords, CalDAV passwords. **Only** the supplier layer (internal/plugin/adapters, which
# injects them into outbound requests; internal/plugin/blockadmin, which writes them) and the
# composition root (cmd/server, which wires the repo into both) may import it. Every other
# layer must get a handle through a narrow port and call through it. A violation = block code
# or a route holding a plaintext token, breaking "credentials never leave the vault".
#
# Works with supplier-secret-no-leak.spec.ts to clamp from both sides: unreachable by
# structure + non-leaking by behavior.
#
# This replaces check-supplier-boundary.sh, which clamped on `internal/gcal` and
# `internal/mailer`. Those two packages no longer exist — their work moved into the supplier
# adapters — so that gate had been passing on an empty scan, which is indistinguishable from
# passing on a clean tree. The self-test below is why this one cannot repeat that.
set -euo pipefail
cd "${1:-.}"   # → target Go source root (backend/)

VAULT='internal/plugin/credentials'

# Directories allowed to reach the vault directly: the supplier layer + the composition root.
ALLOWED='internal/plugin/adapters|internal/plugin/blockadmin|cmd/server'

# find + grep (do not rely on the GNU behavior of grep -r/--include: Alpine's BusyBox grep
# prefixes -r output with ./ and treats --include differently, so the ^ALLOWED exclusion
# mismatches). sed strips the ./ prefix so the anchor matches consistently on both GNU and
# BusyBox.
importers=$(find internal cmd -name '*.go' ! -name '*_test.go' \
  -exec grep -lE "\"github\.com/atmaxmoj/standmeet/${VAULT}\"" {} + 2>/dev/null || true \
  | sed 's|^\./||')

# Self-test: if nothing imports the vault at all, the pattern is wrong (a package rename, a
# BusyBox grep difference) and the gate is blind, not the tree clean. The composition root
# always imports it — that is what wiring the repo means.
if [ -z "$importers" ]; then
  echo "check-supplier-boundary: SELF-TEST FAILED — nothing imports ${VAULT}." >&2
  echo "The scan is blind (renamed package? changed import path?), not the tree clean." >&2
  exit 1
fi

violations=$(printf '%s\n' "$importers" | { grep -vE "^($ALLOWED)/" || true; })

if [ -n "$violations" ]; then
  echo "check-supplier-boundary: the credential vault may only be reached from the supplier layer." >&2
  echo "These files reach it directly, out of bounds (credentials go through a narrow port; block code must not touch the token):" >&2
  echo "$violations" | sed 's/^/  /' >&2
  exit 1
fi

n=$(printf '%s\n' "$importers" | grep -c . || true)
echo "check-supplier-boundary: ${VAULT} reached only from the supplier layer ($n importer(s), all in bounds)."
