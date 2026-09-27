#!/usr/bin/env bash
# check-table-event-policy.sh —— every table in backend/db/schema.sql states whether its changes
# reach the event bus.
#
# The comment block directly above each `CREATE TABLE` carries one of:
#
#   -- events: emit              a trigger on this table inserts into events
#   -- events: none (<reason>)   the table's changes are not row events, and why
#
# A table declared `emit` must have a `CREATE TRIGGER … ON <table> … EXECUTE FUNCTION f()` in
# schema.sql, where f's body inserts into events. A new table thus forces a decision; it is a
# required declaration, not an exclusion list.
# Design: docs/design/event-bus-outbox-webhooks.md, "Enforcement".
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCHEMA="$ROOT/backend/db/schema.sql"

tables="$(grep -cE '^[[:space:]]*CREATE TABLE' "$SCHEMA" || true)"
if [ "$tables" -lt 20 ]; then
	echo "check-table-event-policy: found only $tables CREATE TABLE in $SCHEMA —— the scan is blind, not the schema clean."
	exit 2
fi

# policy: one line per table —— "<table> <emit|none|missing>".
policy="$(awk '
	/^[[:space:]]*--/ { block = block "\n" $0; next }
	/^[[:space:]]*CREATE TABLE/ {
		line = $0
		sub(/^[[:space:]]*CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?/, "", line)
		sub(/[[:space:](].*$/, "", line)
		p = "missing"
		if (block ~ /\n-- events: emit[[:space:]]*(\n|$)/) p = "emit"
		else if (block ~ /\n-- events: none \([^)].*\)[[:space:]]*(\n|$)/) p = "none"
		print line, p
	}
	{ block = "" }
' "$SCHEMA")"

# emitters: tables with a trigger whose function inserts into events.
emitters="$(awk '
	/^[[:space:]]*--/ { next }
	/CREATE (OR REPLACE )?FUNCTION/ {
		fn = $0; sub(/.*FUNCTION[[:space:]]+/, "", fn); sub(/\(.*/, "", fn)
	}
	fn != "" && /INSERT INTO events/ { writes[fn] = 1 }
	/^END[[:space:]]*\$\$;/ { fn = "" }
	/CREATE TRIGGER/ { trig = "" ; intrig = 1 }
	intrig { trig = trig " " $0 }
	intrig && /;/ {
		intrig = 0
		t = trig; sub(/.*[[:space:]]ON[[:space:]]+/, "", t); sub(/[[:space:]].*/, "", t)
		f = trig; sub(/.*EXECUTE (FUNCTION|PROCEDURE)[[:space:]]+/, "", f); sub(/\(.*/, "", f)
		on[t] = on[t] " " f
	}
	END { for (t in on) { n = split(on[t], fs, " "); for (i = 1; i <= n; i++) if (fs[i] in writes) print t } }
' "$SCHEMA" | sort -u)"

fail=0
while read -r table p; do
	[ -n "$table" ] || continue
	case "$p" in
	missing)
		echo "check-table-event-policy: table $table has no \"-- events: emit\" or \"-- events: none (<reason>)\" line directly above its CREATE TABLE —— decide whether its changes reach the bus."
		fail=1
		;;
	emit)
		if ! echo "$emitters" | grep -qx "$table"; then
			echo "check-table-event-policy: table $table is declared \"events: emit\" but schema.sql has no trigger on it that inserts into events."
			fail=1
		fi
		;;
	esac
done <<EOF
$policy
EOF

[ "$fail" -eq 0 ] || exit 1
echo "check-table-event-policy: all $tables tables declare their event policy; every emitter has its trigger."
