#!/usr/bin/env bash
# check-routes-not-imported.sh —— internal/routes/** is the **topmost layer** (controller/reach-out),
# and must not be imported by any other package. Only the assembly entry points may mount it:
# cmd/server (composition root), agentcore (eval driver entry).
#
# Another package (domain / infra / capabilities / usecases) importing routes = inverted layering (lower depends on higher).
# Known existing violations go in backend/.routes-import-baseline (one importer directory per line, relative to backend/;
# can only shrink). The allowed entry points are not in the baseline and are not violations.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BK="$ROOT/backend"
BASELINE="$BK/.routes-import-baseline"
# assembly entry points: allowed to import routes
ALLOWED_ENTRY='^cmd/|^agentcore(/|$)|^internal/routes/'

violations=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	dir="$(dirname "${f#"$BK"/}")"
	echo "$dir" | grep -qE "$ALLOWED_ENTRY" && continue
	case " $violations " in *" $dir "*) ;; *) violations="$violations $dir" ;; esac
done < <(grep -rlE 'atmaxmoj/standmeet/internal/routes/' "$BK/internal" "$BK/cmd" "$BK/agentcore" --include='*.go' 2>/dev/null | grep -v '_test.go' | sort)

if [ "${1:-}" = "seed" ]; then
	for v in $violations; do echo "$v"; done
	exit 0
fi

baseline=""
[ -f "$BASELINE" ] && baseline="$(grep -vE '^\s*(#|$)' "$BASELINE" || true)"

fail=0
for v in $violations; do
	found=0
	for b in $baseline; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-routes-not-imported: $v imports internal/routes/** —— routes is the top layer, only cmd/agentcore may mount it."
		fail=1
	fi
done
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-routes-not-imported: baseline entry $b no longer imports routes; delete this line from .routes-import-baseline (can only shrink)."
		fail=1
	fi
done
[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-routes-not-imported: routes mounted only by entry points (cmd/agentcore) (${n} existing entries left to clean in the baseline, ratchet holds)."
