#!/usr/bin/env sh
# check-one-select —— the whole app has exactly **one** dropdown, and it lives in SelectField.
#
# Why this gate exists (UX-47): before it, 19 `<select>` elements had **five** mutually unaware
# styles — box border / small box / underline / sm-field-input / gate's near-black solid (UX-36
# calls it the heaviest color block on the page). This isn't "a few spots missed", it's **the
# absence of this layer**, so every face decides on its own what a dropdown looks like.
#
# Just adding a `.sm-select` class doesn't fix it: a class has to be remembered and applied, and
# **the next person writing a dropdown won't know it exists** — which is exactly where the five
# earlier styles came from. So the gate locks not "was the class applied" but "did it bypass the
# component": under `app/src`, no `<select` may appear other than in SelectField itself.
# (See [[reframes-tasks-into-enforced-invariants]]: make the mistake impossible, don't just explain it.)
#
# Self-test: feed a planted bad usage to the **same judgment** and it must go red — if it doesn't,
# the scanner is blind (see [[gate-can-go-blind]]: `grep --include` goes silently blind on alpine,
# so this doesn't use it).

set -eu

OWNER="app/src/components/atoms/SelectField.tsx"

fail=0

# scan_selects —— find bare `<select` in JSX across a given file list. Takes filenames as args,
# not stdin.
# **A `<select` in a comment doesn't count** — these files' top comments describe this history, and
# flagging them would force deleting the explanation (see [[gate-scope-forces-architecture]]: an
# over-broad gate pushes code somewhere worse).
scan_selects() {
  awk '
    # Whole-line comment: skip. `{/*` is the JSX comment form — without it, a JSX comment explaining
    # "why no bare select here" would trip the gate itself (it did once, 2026-08-13).
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*)/ { next }
    /<select/                            { print FILENAME ":" FNR ":" $0 }
  ' "$@"
}

files=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -v "^$OWNER$" || true)

# 1) The scanner must actually see files — an empty list makes the check below always green (see [[assertion-that-cannot-fail]]).
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-select: SELF-TEST FAILED — only $n tsx files in scan range, the scan is blind"
  exit 2
fi

# The real scan goes through scan_selects — this used to hold a duplicate copy of the same awk, and
# the JSX-comment rule I'd just added would land on only one of them.
# **A single judgment must not have two copies** ([[copied-invalidation-goes-stale]]).
# shellcheck disable=SC2086  # $files is a newline-separated path list; word splitting is intended here
offenders=$(scan_selects $files || true)

if [ -n "$offenders" ]; then
  echo "check-one-select: a bare <select> bypasses SelectField —— a dropdown may have only one look:"
  echo "$offenders"
  echo "                  use <SelectField> ($OWNER)."
  fail=1
fi

# 2) The component must still exist, and must still contain that one select — otherwise the check above is always green.
if [ ! -f "$OWNER" ]; then
  echo "check-one-select: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q '<select' "$OWNER"; then
  echo "check-one-select: $OWNER no longer renders a <select>"
  fail=1
fi

# 3) Self-test: plant a bad call site, and the same judgment must see it.
planted=$(mktemp -t selcheck.XXXXXX)
cat > "$planted" <<'PLANTED'
export function Planted() {
  return <select><option value="x">x</option></select>;
}
PLANTED
if [ -z "$(scan_selects "$planted")" ]; then
  rm -f "$planted"
  echo "check-one-select: SELF-TEST FAILED — the scan cannot see a planted bare <select>"
  exit 2
fi
rm -f "$planted"

[ "$fail" -eq 0 ] || exit 1
echo "check-one-select: one select, and it lives in SelectField ($n tsx files scanned; self-test passed)."
