#!/usr/bin/env sh
# check-one-layer-scale —— the layer scale may have only **one declaration**.
#
# Why this gate exists: "who is above whom" is **unreadable** in this app. 19 layer values are scattered
# across two languages — nine CSS magic numbers (30/35/40/41/50/60/60/60/80), ten TSX utility classes
# (z-10/20/30/40×5/50×2), and not one of them declares the ordering meaning of these numbers. And the
# single thing "modal scrim" itself has **three different z's** (ModalShell's z-50, 5 inline overlays'
# z-40, the CSS overlay's 60) — the modal isn't even one layer.
#
# The consequence isn't ugliness: whether a scrim covers the layer below **can only be found by trying**.
# The owner's rule is "you may not tell things apart by experiment, either read the logs or make the
# architecture clear enough to see at a glance" — this gate makes "see at a glance" mandatory (see
# [[no-diagnosis-by-experiment]]).
#
# The only allowed form: CSS uses `var(--z-*)`, TSX uses `z-[var(--z-*)]`. The scale itself is in the
# :root of globals.css.
#
# Self-test: plant a bare z-index and a bare z-40, and both judgments must see them — the scanner must
# prove it can see (see [[gate-can-go-blind]]; the previous gate's self-test covered only the file type
# it chose and missed the other half).

set -eu

TOKEN_FILE="app/src/app/globals.css"
fail=0

if ! grep -q -- '--z-modal:' "$TOKEN_FILE"; then
  echo "check-one-layer-scale: the layer scale (--z-*) is not defined in $TOKEN_FILE"
  fail=1
fi

# bare_css —— any z-index in CSS that **doesn't go through the scale**. **No exceptions.**
#
# I once granted an exemption for `z-index: 0 / auto` (the reasoning being they don't claim "I'm at
# global layer N" but create a stacking context in place). The owner overruled it: "if you've moved
# everything to css-defined z, then ban bare z-index with lint". He was right — **a rule with
# exceptions gets eroded**: that exemption was one judgment of mine, the next person has to re-judge it,
# and "does this count as a layer declaration" is precisely the easiest place to talk yourself into it.
# The legitimate use is still expressible, it just also goes through the scale: `z-index: var(--z-local)` (=0).
bare_css=$(find app/src -name '*.css' -print0 2>/dev/null | xargs -0 -r grep -n 'z-index:' \
  | grep -v -- 'var(--z-' | grep -v -- '--z-' || true)
if [ -n "$bare_css" ]; then
  echo "check-one-layer-scale: a bare z-index instead of var(--z-*):"
  echo "$bare_css"
  fail=1
fi

# An in-band offset may only be +1..+9. Layers are spaced 10 apart, so `calc(var(--z-modal) + 1)` is
# "ordering within the same band", while `+ 10` collides with the next layer — that's not ordering,
# that's **silently changing layers**, and it looks identical to the legitimate form. Relative offsets
# are allowed so that "who covers whom" is written at the scale where it belongs: cross-layer changes
# edit this table, in-band ordering is written where it's used.
big_offset=$(find app/src -name '*.css' -o -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE 'var\(--z-[a-z-]+\)[[:space:]]*\+[[:space:]]*[0-9]{2,}' || true)
if [ -n "$big_offset" ]; then
  echo "check-one-layer-scale: a layer offset of 10+ escapes its band — use +1..+9:"
  echo "$big_offset"
  fail=1
fi

# bare_tsx —— bare z-<n> utility classes in TSX. Only in a class string, to avoid catching variable names.
#
# **TSX may only write class names**: `sm-z-modal` / `sm-z-modal-3`. Bare `z-40` and arbitrary-value
# `z-[...]` are both banned — the latter does point at the scale, but it makes "layer" appear in two
# forms at the place of use, and **one concept in two forms** is the start of vocabulary divergence
# (see [[vocabulary-must-not-diverge]]). Once collapsed to a closed set, "what layer is this on" always
# has only one reading.
#
# **All quote kinds must be caught**: the first version recognized only `className="…"`, so
# `className={`…`}` (template literals) were a whole invisible class — `z-50` in BubbleToolbar survived
# this way, while the gate reported green. Worse, that version's **self-test** also planted the
# double-quote kind: it only proved the scanner recognized what it already recognized, **not that the
# scan range covers where the escape actually happens** (see [[gate-can-go-blind]] /
# [[verifier-can-lie-about-its-own-coverage]]). Now both quote kinds are caught, and the self-test
# plants both.
bare_tsx=$(find app/src -name '*.tsx' -print0 2>/dev/null \
  | xargs -0 -r grep -nE '(class|className)=[{]?["`][^"`]*[[:space:]"`](z-[0-9]+|z-\[)' || true)
if [ -n "$bare_tsx" ]; then
  echo "check-one-layer-scale: use a layer class (sm-z-<band>[-1..9]), not z-<n> or z-[...]:"
  echo "$bare_tsx"
  fail=1
fi

# Self-test: feed each of the two judgments a planted bad usage, and both must go red.
planted_css=$(mktemp -t layercss.XXXXXX); planted_tsx=$(mktemp -t layertsx.XXXXXX)
printf '.sm-planted { z-index: 42; }\n' > "$planted_css"
{
  printf '<div className="fixed inset-0 z-40" />\n'
  printf '<div className={`fixed inset-0 z-50 ${x}`} />\n'
} > "$planted_tsx"
seen_css=$(grep -n 'z-index:' "$planted_css" | grep -v -- '--z-' || true)
# One line per quote kind, so this requires **both** be seen — hitting only one means a whole class is still a blind spot.
tsx_hits=$(grep -cE '(class|className)=[{]?["`][^"`]*[[:space:]"`]z-[0-9]+' "$planted_tsx" || true)
seen_tsx=''
[ "$tsx_hits" = "2" ] && seen_tsx='both'
rm -f "$planted_css" "$planted_tsx"
if [ -z "$seen_css" ] || [ -z "$seen_tsx" ]; then
  echo "check-one-layer-scale: SELF-TEST FAILED — the scan misses a planted bare layer value"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-layer-scale: one layer scale (self-test passed: planted bare css + tsx both go red)."
