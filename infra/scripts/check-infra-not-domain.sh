#!/usr/bin/env bash
# check-infra-not-domain.sh —— internal/infra/** must not reverse-import any **domain** (core module).
#
# infra is domain-less base infrastructure (pgxpool / crypto / http / storage / …), and is a **leaf**.
# It reverse-importing a domain (corpus/access/owner/…) = an inverted layering. Infra serves domains; it does not know domains.
#
# Known existing violations go in backend/.infra-domain-baseline (one file per line, can only shrink:
# fix one, delete a line; also delete entries no longer present in the baseline). An infra→domain import outside the baseline = red.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INFRA="$ROOT/backend/internal/infra"
BASELINE="$ROOT/backend/.infra-domain-baseline"
DOMAINS='corpus|conversation|connector|access|owner|security|marketplace|stats'

# goFiles —— NOT `grep --include`: the image lint runs on alpine, whose BusyBox grep does not know
# that flag. It exits 2 with no output, and "found nothing" reads exactly like "tree is clean" —
# this gate reported green from inside the image for every build until 2026-08-01. `find` is portable.
goFiles() {
	find "$INFRA" -type f -name '*.go' 2>/dev/null | grep -v '_test\.go$' | sort
}

# scanned —— proof the scan can see the tree. A blind gate must go RED, not green.
scanned="$(goFiles | wc -l | tr -d ' ')"
if [ "$scanned" -lt 10 ]; then
	echo "check-infra-not-domain: scanned only $scanned Go files under $INFRA — the scan is blind, not the tree clean."
	exit 2
fi

# Files in infra that currently import a domain (relative to backend/)
violations=""
while IFS= read -r f; do
	[ -n "$f" ] || continue
	violations="$violations ${f#"$ROOT"/backend/}"
done < <(goFiles | xargs grep -lE "atmaxmoj/standmeet/internal/($DOMAINS)\"" 2>/dev/null | sort)

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
		echo "check-infra-not-domain: $v imports a domain (core module) —— infra is a leaf and must not reverse-depend on a domain."
		fail=1
	fi
done
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-infra-not-domain: baseline entry $b no longer imports a domain; delete this line from .infra-domain-baseline (can only shrink)."
		fail=1
	fi
done
[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-infra-not-domain: infra does not reverse-depend on domains (${n} existing entries left to clean in the baseline, ratchet holds)."
