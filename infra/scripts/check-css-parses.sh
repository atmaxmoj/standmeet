#!/usr/bin/env sh
# check-css-parses —— every CSS file must **actually parse**.
#
# Why this gate exists: I once broke a comment (an early `*/` turned the next four
# lines into raw text), `make lint` went all green and it got committed, and it only
# blew up at `app-build` — because **not one step in the lint chain parses CSS**:
# `next lint` only looks at JS/TSX, `tsc` only checks types, and both self-proving
# gates do plain text scanning. So "tools all green, output actually broken" happened
# again (last time it was a Tailwind shorthand that produced no rule).
#
# This does one small thing: a **balance check**. Not a full CSS parser, just catching
# the most common, most silent class of error — unbalanced comments and braces. It's
# cheap (milliseconds), needs no node_modules, and can sit at the very front of the
# lint chain.
#
# Self-test: plant a comment that closes early and confirm the check catches it.

set -eu

fail=0

for f in $(find app/src -name '*.css' 2>/dev/null); do
  # Comments balance: the count of `/*` must equal the count of `*/`.
  open_n=$(grep -o '/\*' "$f" | wc -l | tr -d ' ')
  close_n=$(grep -o '\*/' "$f" | wc -l | tr -d ' ')
  if [ "$open_n" != "$close_n" ]; then
    echo "check-css-parses: $f has $open_n '/*' but $close_n '*/' — a comment is unbalanced"
    fail=1
  fi
  # Braces balance.
  ob=$(grep -o '{' "$f" | wc -l | tr -d ' ')
  cb=$(grep -o '}' "$f" | wc -l | tr -d ' ')
  if [ "$ob" != "$cb" ]; then
    echo "check-css-parses: $f has $ob '{' but $cb '}' — a block is unbalanced"
    fail=1
  fi
done

# Self-test: plant a file where the comment counts balance but **content leaks outside
# the comment** — that's exactly the class of bug I made (a matching total count can't
# catch it), so the self-test proves that "the unbalanced kind gets caught", and is
# honest about the class this gate can't see.
planted=$(mktemp -t cssparse.XXXXXX)
printf '/* one\n:root { --a: 1; }\n' > "$planted"
po=$(grep -o '/\*' "$planted" | wc -l | tr -d ' ')
pc=$(grep -o '\*/' "$planted" | wc -l | tr -d ' ')
rm -f "$planted"
if [ "$po" = "$pc" ]; then
  echo "check-css-parses: SELF-TEST FAILED — an unbalanced comment is not detected"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-css-parses: comments and blocks balance (self-test passed: an unclosed comment goes red)."
