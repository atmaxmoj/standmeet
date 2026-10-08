#!/usr/bin/env bash
# check-connector-kinds-in-data.sh —— a connector's kind, the seam it provides, and an auth field's
# type are looked up in a declaration table, never switched on (refactor ledger R12).
#
# Each of these used to be a `switch` with one case per kind, repeated in several places: adding a
# supplier kind meant finding every switch (supplier_register.go twice, credform.go twice) and
# nothing said when one was missed — the new kind fell into a `default:` that errored at runtime or,
# worse, rendered an empty form. A table is one row per kind, and an unknown kind is one lookup
# miss with one message.
#
# Banned, in backend Go outside tests:
#   switch m.Kind / switch m.Provides       —— a manifest (or form Source) branching on its kind
#   switch <x>.Fields[i].Type               —— an auth form branching on field type
#
# The gate matches by the names these declarations go by (a manifest is `m` across blockwire,
# adapters and credform). A switch on a renamed variable would pass; the self-test plants the
# canonical shape.
set -eu

ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)/backend}"
PATTERN='switch m\.(Kind|Provides)\b|switch [A-Za-z_.]+\.Fields\[[^]]*\]\.Type\b'

files="$(find "$ROOT/cmd" "$ROOT/internal" -type f -name '*.go' ! -name '*_test.go' | wc -l | tr -d ' ')"
if [ "$files" -lt 1 ]; then
	echo "check-connector-kinds-in-data: found no Go files under $ROOT — the scan is blind."
	exit 2
fi

hits="$(find "$ROOT/cmd" "$ROOT/internal" -type f -name '*.go' ! -name '*_test.go' -print0 |
	xargs -0 grep -nE "$PATTERN" 2>/dev/null || true)"
if [ -n "$hits" ]; then
	echo "$hits" | sed "s|^$ROOT/||"
	echo "check-connector-kinds-in-data: a connector kind / provided seam / auth field type is switched on —— add a row to its declaration table instead (supplierKinds, blockSeamProxies, credFormKinds, authFieldRoles)."
	exit 1
fi
echo "check-connector-kinds-in-data: connector kinds, provided seams and auth field types are table lookups ($files files scanned)."
