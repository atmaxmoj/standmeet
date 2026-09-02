#!/usr/bin/env sh
# check-no-computed-class —— Tailwind arbitrary-value brackets must never contain interpolation.
#
# Why this gate exists:
# Tailwind decides which rules to generate by **scanning source at build time**. A pieced-together
# class like `[--max-w:${maxWidth}px]` scans as an invalid string, so **zero CSS gets generated** —
# yet that string still lands in the HTML.
# The result is "the class name is there, the rule isn't", the variable falls back to its default,
# and **no tool ever errors**: tsc sees a valid template string, eslint doesn't check CSS, and the
# browser stays silent on an unknown class name.
#
# This failure shape has already happened four times in this codebase, and every time the damage
# was not "the style is slightly off":
#   - `.sm-max-w`  default 100%  → **every modal became full-width**, the `maxWidth` prop never took effect (UX-48)
#   - `.sm-fill`   default 0%    → the resume-match bar + visitor quota bar **never showed any value at all**
#   - `.sm-pos-abs` default 0,0  → the editor's bubble toolbar **never followed the selection**
# All three are [[names-that-lie]]: something on screen whose name claims to express a quantity,
# while it was a constant the whole time.
#
# The fix is always the same: route dynamic values through `style={{ '--x': v }}` — that's real
# inline CSS, and it never goes through any scan.
#
# Self-check: plant one bad form for each quote style; the same detection must catch both — catching
# only one means a whole blind-spot class remains
# (see [[gate-can-go-blind]]: the previous gate missed a template-literal `z-50` because it only
# recognized double quotes).

set -eu

fail=0

# PATTERN —— a `${` appearing inside a bracketed arbitrary value in a className/class attribute.
# `]` is not allowed inside the brackets, so `[^]]*` is enough to mark "still inside this arbitrary value".
PATTERN='(class|className)=[{]?["`][^"`]*\[[^]]*\$\{'

offenders=$(find app/src -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE "$PATTERN" || true)

if [ -n "$offenders" ]; then
  echo "check-no-computed-class: an interpolated Tailwind arbitrary value generates NO css."
  echo "                         pass dynamic values via style={{ '--x': value }}:"
  echo "$offenders"
  fail=1
fi

# Scan-range self-check: an empty file list would make the check above always green (see [[assertion-that-cannot-fail]]).
n=$(find app/src -name '*.tsx' -type f 2>/dev/null | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-no-computed-class: SELF-TEST FAILED — only $n tsx files in range, the scan is blind"
  exit 2
fi

# Detection self-check: both double quotes and template literals must be seen.
planted=$(mktemp -t compclass.XXXXXX)
{
  printf '<div className="w-full [--max-w:${w}px]" />\n'
  printf '<div className={`sm-fill [--fill:${pct}%%]`} />\n'
} > "$planted"
hits=$(grep -cE "$PATTERN" "$planted" || true)
rm -f "$planted"
if [ "$hits" != "2" ]; then
  echo "check-no-computed-class: SELF-TEST FAILED — saw $hits/2 planted interpolations"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-no-computed-class: no interpolated arbitrary values ($n tsx files; self-test passed on both quote forms)."
