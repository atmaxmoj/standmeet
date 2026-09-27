#!/usr/bin/env bash
# check-tx-only-via-pgstore.sh —— a transaction opens only through pgstore.InTx.
#
# The transaction is an explicit parameter: InTx hands it to fn, and whoever joins it is handed it
# (repo.With(tx), events.With(tx), jobs.With(tx)). A hand-opened Begin is the way a write drifts
# out of the transaction its event is recorded in, and the way a Rollback goes unchecked.
#
# `.Begin(`, `BeginTx(` or `BeginFunc(` anywhere in backend/ (non-test) outside
# internal/infra/pgstore is red.
# Design: docs/design/event-bus-outbox-webhooks.md, "Code structure".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
ALLOWED='^internal/infra/pgstore/'

goFiles() {
	find "$BK" -type f -name '*.go' -not -name '*_test.go' -not -path '*/node_modules/*' | sort
}

scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 100 ]; then
	echo "check-tx-only-via-pgstore: scanned only $scanned Go files under $BK —— the scan is blind, not the tree clean."
	exit 2
fi

fail=0
while IFS= read -r hit; do
	[ -n "$hit" ] || continue
	rel="${hit#"$BK"/}"
	echo "$rel" | grep -qE "$ALLOWED" && continue
	echo "check-tx-only-via-pgstore: $rel —— opens a transaction by hand; use pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {…})."
	fail=1
done < <(goFiles | xargs grep -nE '\.Begin\(|BeginTx\(|BeginFunc\(|BeginTxFunc\(' 2>/dev/null | sort)

[ "$fail" -eq 0 ] || exit 1
echo "check-tx-only-via-pgstore: transactions open only in internal/infra/pgstore."
