#!/usr/bin/env bash
# check-sql-constant self-test: a gate that cannot go red is not a gate.
#
# Plants each shape of runtime-built SQL, one at a time, and asserts the checker goes red on it;
# then asserts it is green again once the plant is gone. Run with CWD=backend.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLANT="internal/zz_planted_sql_selftest/planted.go"
TOOL="$(mktemp)"
cleanup() { rm -rf "$(dirname "$PLANT")" "$TOOL"; }
trap cleanup EXIT
( cd "$HERE/check-sql-constant" && go build -o "$TOOL" . )

plant() {
  mkdir -p "$(dirname "$PLANT")"
  printf 'package planted\n\nimport (\n\t"fmt"\n\n\t"github.com/atmaxmoj/standmeet/internal/infra/sqltext"\n)\n\nvar _ = fmt.Sprint\nvar _ = sqltext.Format\n\n%s\n' "$1" > "$PLANT"
  if "$TOOL" >/dev/null 2>&1; then
    echo "check-sql-constant: SELF-TEST FAILED — passed with: $2"
    exit 1
  fi
}

plant 'func q(table string) string { return fmt.Sprintf("SELECT * FROM %s WHERE id = $1", table) }' \
  "SQL built with fmt.Sprintf"
plant 'func q(where string) string { return "SELECT * FROM t WHERE " + where }' \
  "SQL concatenated with a runtime string"
plant 'func q(tmpl, s string) string { return sqltext.Format(tmpl, s) }' \
  "a sqltext.Format template that is not source text"

rm -rf "$(dirname "$PLANT")"
if ! "$TOOL" >/dev/null 2>&1; then
  echo "check-sql-constant: SELF-TEST FAILED — red after removing the planted file."
  exit 1
fi
echo "check-sql-constant: self-test passed (Sprintf, concatenation and a runtime template all go red)."
