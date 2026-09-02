#!/usr/bin/env sh
# check-peek-signals-more —— a preview card that **will be clipped** must have a
# continue-reading signal at the cut.
#
# Why this gate exists (UX-56):
# summarize's report card is a **deliberate** sneak-peek — the inner iframe is fixed
# at 280px, and any report longer than that gets clipped. But the cut originally had
# no signal at all: the body breaks mid-sentence against the card border, reading as
# "broken" rather than "more". The continue-reading entry point (`open as page ↗`)
# was always in the header — what was missing was just saying "you need to use it".
#
# **Be explicit about what this gate can and can't catch**:
#   Catches — someone **deleting** the fade rule outright (the realistic regression:
#     dropped incidentally while refactoring card styles).
#   Doesn't catch — someone **weakening** the gradient to transparent→transparent, etc.
# A gate that only catches "deleted" is still worth having, but calling it "guarantees
# the cut always has a signal" would be a lie.
# (Tried on the e2e side: the pseudo-element has no locator, and measuring card height
#  can't detect the fade at all — that kind of assertion looks like it's guarding but
#  can never go red, see [[assertion-that-cannot-fail]]. So guard at the source instead.)
#
# Self-test: feed the same check a template with the fade removed — it must go red.

set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/mcp-servers/summarize/content.go"

fail=0

if [ ! -f "$TARGET" ]; then
  echo "check-peek-signals-more: $TARGET is gone — the rule has no subject"
  exit 2
fi

# scan —— in the card template, a fixed-height preview iframe must **also** have a
# fade rule covering the cut. Both conditions are checked together: fade with no
# fixed height = this rule no longer has a subject, worth someone taking a look too.
#
# **The check must span lines**: in the real template, `.card::after{...}` and its
# `linear-gradient` sit on two separate lines — the first version used a line-by-line
# `grep -qE` to find both, so **even a correct template got judged red**, and self-test
# 2 ("a template with a fade must not go red") blew up along with it. The self-test
# saved this one: if only self-test 1 existed, this blind check would ship with a
# green lie ([[gate-can-go-blind]]). So the whole file is flattened to one line first,
# then the rule block is checked.
has_fixed_peek() { tr '\n' ' ' < "$1" | grep -qE 'iframe *\{[^}]*height: *[0-9]+px'; }
has_fade()       { tr '\n' ' ' < "$1" | grep -qE '\.card::after *\{[^}]*linear-gradient'; }

if has_fixed_peek "$TARGET" && ! has_fade "$TARGET"; then
  echo "check-peek-signals-more: the report card clips at a fixed height with nothing at the cut."
  echo "                 A preview that will inevitably be clipped needs a continue-reading"
  echo "                 signal (fade) at the cut, otherwise the body breaking off mid-sentence"
  echo "                 reads as broken, not as \"more\"."
  fail=1
fi

# Self-test 1: a template with the fade removed must go red.
planted=$(mktemp -t peek.XXXXXX)
cat > "$planted" <<'PLANTED'
 .card{border:1px solid #d9d0c2;overflow:hidden}
 iframe{width:100%;height:280px;border:none}
PLANTED
if ! { has_fixed_peek "$planted" && ! has_fade "$planted"; }; then
  rm -f "$planted"
  echo "check-peek-signals-more: SELF-TEST FAILED — a template with no fade is not seen"
  exit 2
fi
rm -f "$planted"

# Self-test 2: a template with a fade must not go red (an overly broad gate pushes
# the code somewhere worse).
ok=$(mktemp -t peek-ok.XXXXXX)
cat > "$ok" <<'OKCASE'
 .card{border:1px solid #d9d0c2;overflow:hidden;position:relative}
 .card::after{content:"";position:absolute;bottom:1px;height:56px;
   background:linear-gradient(to bottom,rgba(255,255,255,0),#fff);pointer-events:none}
 iframe{width:100%;height:280px;border:none}
OKCASE
if has_fixed_peek "$ok" && ! has_fade "$ok"; then
  rm -f "$ok"
  echo "check-peek-signals-more: SELF-TEST FAILED — a template WITH a fade is red"
  exit 2
fi
rm -f "$ok"

[ "$fail" -eq 0 ] || exit 1
echo "check-peek-signals-more: the clipped preview carries a fade at the cut (both self-tests passed)."
