#!/usr/bin/env bash
# check-internal-dirs.sh —— under backend/internal/ only three kinds of directory are allowed:
#   1) the 8 core domain modules from the class diagram (backend-domain-modules.md class diagram)
#   2) the real inbound controller routes
#   3) the domain-less shared DDD infrastructure (///... — see the whitelist)
# A directory not in the class diagram and not in any of the above = "an extra thing", and must be
# broken up and put back (move the feature into a core module, or externalize it out of internal/, like plugins->mcp-servers/).
#
# A directory outside the whitelist is red on hit. Known existing violations to break up go in
# .internal-dirs-baseline (can only shrink: break one up, delete a line; also delete directories no
# longer present in the baseline). A new directory outside the whitelist = red.
#
# Usage: check-internal-dirs.sh [seed]   seed re-seeds the baseline
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INTERNAL="$ROOT/backend/internal"
BASELINE="$ROOT/backend/.internal-dirs-baseline"

# -- whitelist: class-diagram core modules + routes + domain-less infra --
ALLOWED="
access conversation connector corpus owner security marketplace stats capabilities
routes infra
"

is_allowed() {
	for a in $ALLOWED; do [ "$1" = "$a" ] && return 0; done
	return 1
}

# all directories currently under internal/
dirs=""
for d in "$INTERNAL"/*/; do
	[ -d "$d" ] || continue
	dirs="$dirs $(basename "$d")"
done

# violations = directories outside the whitelist
violations=""
for d in $dirs; do
	is_allowed "$d" || violations="$violations $d"
done

if [ "${1:-}" = "seed" ]; then
	for v in $violations; do echo "$v"; done | sort
	exit 0
fi

# known violations in the baseline
baseline=""
[ -f "$BASELINE" ] && baseline="$(grep -vE '^\s*(#|$)' "$BASELINE" || true)"

fail=0

# 1) a violation not in the baseline → a new extra directory, red
for v in $violations; do
	found=0
	for b in $baseline; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-internal-dirs: internal/$v is not in the whitelist (class diagram/routes/infra) and not in the baseline —— a directory absent from the class diagram must not be added; break it up and put it back."
		fail=1
	fi
done

# 2) a directory in the baseline no longer exists (broken up) → must be deleted from the baseline (can only shrink)
for b in $baseline; do
	found=0
	for v in $violations; do [ "$v" = "$b" ] && found=1; done
	if [ "$found" -eq 0 ]; then
		echo "check-internal-dirs: baseline entry internal/$b is broken up; delete this line from backend/.internal-dirs-baseline (the baseline can only shrink)."
		fail=1
	fi
done

[ "$fail" -eq 0 ] || exit 1

n="$(printf '%s\n' $baseline | grep -c . || true)"
echo "check-internal-dirs: internal/ holds only whitelisted directories (${n} existing entries left to break up in the baseline, ratchet holds)."
