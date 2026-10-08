#!/usr/bin/env bash
# check-connector-kinds-in-data self-test: a gate that cannot go red is not a gate.
#
# Plants both banned shapes — a switch on a manifest's kind, and a switch on an auth field's type —
# and asserts each one is caught, then that the tree is green again once they are gone.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$HERE/../../backend}"
PLANT="$ROOT/internal/infra/credform/zz_planted_kinds_selftest.go"

cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT

plant() {
	printf 'package credform\n\n// planted by check-connector-kinds-in-data-test.sh; removed again.\nfunc planted(m *Source, f *form) {\n\t%s {\n\t}\n}\n' "$1" > "$PLANT"
	if bash "$HERE/check-connector-kinds-in-data.sh" "$ROOT" >/dev/null 2>&1; then
		echo "check-connector-kinds-in-data: SELF-TEST FAILED — '$1' passed."
		exit 1
	fi
	rm -f "$PLANT"
}

plant 'switch m.Kind'
plant 'switch m.Provides'
plant 'switch f.Fields[i].Type'

cleanup
trap - EXIT
if ! bash "$HERE/check-connector-kinds-in-data.sh" "$ROOT" >/dev/null 2>&1; then
	echo "check-connector-kinds-in-data: SELF-TEST FAILED — red after removing the planted file."
	exit 1
fi
echo "check-connector-kinds-in-data: self-test passed (kind, provides and field-type switches go red)."
