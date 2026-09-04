#!/usr/bin/env sh
# check-one-section-heading —— the admin "section heading" has only one form, and it comes from AdminSectionHead.
#
# Why this gate exists (UX-79): before it, headings at the same level had **four** mutually unaware
# forms in admin — a `.sm-section-h` div, a `.sm-smallcaps` div (system's five cards), a mono 10.5px
# uppercase h3 (calendar), a kicker + large serif h3 (capabilities); and the two groups on the
# connectors page had no heading at all. Each new page meant "remember to add one too", so each time
# the next page was missed.
#
# **Why a gate couldn't be added before**: a section heading and a field name have the same shape in
# the DOM (mono + small + uppercase), and the old signature `tracking-[0.18em]` has over a hundred
# occurrences in app/src — scanning by shape only turns up noise. **The component comes first, then the
# class name becomes a checkable signature**; this gate locks "did it bypass the component", not "was
# the class applied". (See [[reframes-tasks-into-enforced-invariants]].)
#
# Self-test: feed a planted component-bypass to the **same judgment** and it must go red — if it
# doesn't, the scanner is blind (see [[gate-can-go-blind]]: `grep --include` goes silently blind on
# alpine, so this doesn't use it).

set -eu

OWNER="app/src/components/admin/AdminSectionHead.tsx"
CSS="app/src/app/sm-atoms.css"

fail=0

# scan_heads —— find bare usages of `.sm-section-h`. A class named in a comment doesn't count — these
# files' top comments describe this history, and flagging them would force deleting the explanation
# (see [[gate-scope-forces-architecture]]).
scan_heads() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    /sm-section-h/                         { print FILENAME ":" FNR ":" $0 }
  ' "$@"
}

files=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -v "^$OWNER$" || true)

# 1) The scanner must actually see files — an empty list makes the check below always green (see [[assertion-that-cannot-fail]]).
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-section-heading: SELF-TEST FAILED — only $n tsx files in scan range, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files is a newline-separated path list; word splitting is intended here
offenders=$(scan_heads $files || true)

if [ -n "$offenders" ]; then
  echo "check-one-section-heading: .sm-section-h bypasses AdminSectionHead —— a section heading may have only one look:"
  echo "$offenders"
  echo "                           use <AdminSectionHead> ($OWNER)."
  fail=1
fi

# 2) The component and class must still exist — otherwise the check above is always green (when the component is deleted the gate must shout, not pass quietly).
if [ ! -f "$OWNER" ]; then
  echo "check-one-section-heading: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q 'sm-section-h' "$OWNER"; then
  echo "check-one-section-heading: $OWNER no longer renders .sm-section-h"
  fail=1
fi

if ! grep -q '^\.sm-section-h' "$CSS"; then
  echo "check-one-section-heading: .sm-section-h is no longer defined in $CSS"
  fail=1
fi

# 3) Self-test: plant a component-bypassing call site, and the same judgment must see it.
planted=$(mktemp -t headcheck.XXXXXX)
cat > "$planted" <<'PLANTED'
export function Planted() {
  return <div className="sm-section-h mb-3">deployment</div>;
}
PLANTED
if [ -z "$(scan_heads "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-section-heading: SELF-TEST FAILED — the scan cannot see a planted bare .sm-section-h"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-section-heading: one section heading, and it lives in AdminSectionHead ($n tsx files scanned; self-test passed)."
