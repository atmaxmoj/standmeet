#!/usr/bin/env bash
# check-connector-boundary.sh —— Phase B structure gate: credentials never leave the vault (go-arch level).
#
# Outbound connector clients (internal/gcal · internal/mailer, which hold the owner token/password
# and call on their behalf) **may only** be depended on by the connector layer (internal/connector)
# + the composition root (cmd/server). The capability / usecases layers **must not import them
# directly** —— they must get a handle through the connector proxy and call through it. A violation =
# capability code holding a plaintext token, breaking "credentials never leave the vault".
#
# Works with connector-secret-no-leak.spec.ts to clamp from both sides: unreachable by structure +
# non-leaking by behavior. This check turns green once Phase B lands (moving gcal/mailer calls into internal/connector).
set -euo pipefail
cd "${1:-.}"   # → target Go source root (backend/)

# Directories allowed to reach the outbound clients directly: connector layer + wiring (composition root).
ALLOWED='internal/connector|cmd/server'

# find + grep (do not rely on the GNU behavior of grep -r/--include: Alpine's BusyBox grep prefixes
# -r output with ./ and treats --include differently, so the ^ALLOWED exclusion mismatches). sed strips
# the ./ prefix so the anchor matches consistently on both GNU and BusyBox.
violations=$(find internal cmd -name '*.go' ! -name '*_test.go' \
  -exec grep -lE '"github\.com/atmaxmoj/standmeet/internal/(gcal|mailer)"' {} + 2>/dev/null || true \
  | sed 's|^\./||' \
  | { grep -vE "^($ALLOWED)/" || true; })

if [ -n "$violations" ]; then
  echo "check-connector-boundary: outbound connector clients (gcal/mailer) may only be reached through the connector layer." >&2
  echo "The following files reach them directly, out of bounds (credentials must go through the connector proxy; capability must not touch the token):" >&2
  echo "$violations" | sed 's/^/  /' >&2
  exit 1
fi
echo "check-connector-boundary: gcal/mailer reached only through the connector layer."
