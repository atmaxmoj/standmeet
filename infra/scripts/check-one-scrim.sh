#!/usr/bin/env sh
# check-one-scrim —— a modal scrim may have only **one source**.
#
# Why this gate exists (UX-48): four `*-overlay` rules each originally wrote their own
# `color-mix(in oklab, var(--color-ink) 40%, transparent)`. The four literals didn't know each other
# existed — tune one and the other three silently diverge, and divergence doesn't error in the UI, it
# just makes some modals cover the layer below and others not.
#
# It locks the **structure**, not the value: the value (66%) is an aesthetic judgment, and asserting
# it equals itself is a vacuous tautology; what actually rots is "four spots each writing their own".
#
# **The scope is deliberately narrowed to `background` inside `-overlay` rule blocks** —
# `color-mix(ink, N%)` is itself a legitimate technique this visual language uses everywhere (paper
# texture, code-block backgrounds, blockquote left rules). The first version didn't narrow and flagged
# them all red: an over-broad gate forces legitimate code to detour (see [[gate-scope-forces-architecture]]).
#
# Self-test: feed a planted bad usage to the same judgment and it must go red; if it doesn't, the
# scanner is blind (see [[gate-can-go-blind]]).

set -eu

CSS_DIR="app/src"
TOKEN_FILE="app/src/app/globals.css"

fail=0

# 1) The token must exist — otherwise every var(--sm-scrim) below is an empty reference, and an empty reference is silent in CSS.
if ! grep -q -- '--sm-scrim:' "$TOKEN_FILE"; then
  echo "check-one-scrim: --sm-scrim is not defined in $TOKEN_FILE"
  fail=1
fi

# scan_overlays —— find a hand-rolled background inside a `*-overlay {` block. Takes CSS, prints on match.
scan_overlays() {
  awk '
    /-overlay[^{]*\{/ { inblock = 1 }
    inblock && /background[^;]*color-mix/ { print FILENAME ":" FNR ": " $0 }
    inblock && /\}/ { inblock = 0 }
  ' "$@"
}

offenders=$(find "$CSS_DIR" -name '*.css' -print0 2>/dev/null | xargs -0 -r awk '
  /-overlay[^{]*\{/ { inblock = 1 }
  inblock && /background[^;]*color-mix/ { print FILENAME ":" FNR ":" $0 }
  inblock && /\}/ { inblock = 0 }
' || true)

if [ -n "$offenders" ]; then
  echo "check-one-scrim: an *-overlay rule hand-rolls its scrim instead of using var(--sm-scrim):"
  echo "$offenders"
  fail=1
fi

# 2) Inline scrims in TSX —— **the first version of the gate was completely blind to this class**,
#    and the real majority of scrims lives here: 6 spots of
#    `className="fixed inset-0 ... bg-(--color-ink)/40"`, none of them scanned.
#    The first version even had a "self-test", but it only proved "a bad example planted in the file
#    type I chose to scan can be seen", **not that the scan range covers where scrims actually live**
#    — the self-test proved the wrong thing (see [[gate-can-go-blind]]).
inline=$(grep -rn -- 'fixed inset-0' app/src 2>/dev/null \
  | grep -- 'bg-(--color-ink)/' || true)
if [ -n "$inline" ]; then
  echo "check-one-scrim: an inline overlay hand-rolls its scrim instead of bg-(--sm-scrim):"
  echo "$inline"
  fail=1
fi

# 3) The `bg-(--x)` shorthand **only works for tokens registered in `@theme`**. `--sm-scrim` is in a
#    plain `:root`, so Tailwind doesn't recognize it and **generates not one line of CSS** — the class
#    lands in the HTML, the rule doesn't exist, and the scrim goes from 40% to 0.
#    I actually did this once, and typecheck / eslint / this gate were all **green** at the time: no
#    tool says "this class has no matching rule". Only a look at the real environment revealed the text
#    underneath had become clearer instead. So the shorthand form is explicitly banned here; only
#    `bg-[var(--sm-scrim)]` is allowed.
shorthand=$(grep -rn -- 'bg-(--sm-scrim)' app/src 2>/dev/null || true)
if [ -n "$shorthand" ]; then
  echo "check-one-scrim: bg-(--sm-scrim) generates NO css (--sm-scrim is not a @theme token)."
  echo "                 use bg-[var(--sm-scrim)] instead:"
  echo "$shorthand"
  fail=1
fi

# 4) Self-test: plant a bad overlay rule, and the same judgment must see it.
planted_file=$(mktemp -t scrimcheck.XXXXXX)
cat > "$planted_file" <<'PLANTED'
.sm-planted-modal-overlay {
  position: fixed;
  background: color-mix(in oklab, var(--color-ink) 40%, transparent);
}
PLANTED
if [ -z "$(scan_overlays "$planted_file")" ]; then
  rm -f "$planted_file"
  echo "check-one-scrim: SELF-TEST FAILED — the scan cannot see a planted hand-rolled scrim"
  exit 2
fi
rm -f "$planted_file"

# The accent color and focus ring of native controls may also each have only **one** declaration
# (UX-33 / UX-50). Neither was declared anywhere before — so checkboxes and focus rings used system
# blue, the only foreign color on a paper/ink/vermillion layout. They are declared on html/body and
# *:focus-visible, and components may not each write their own: the moment one component overrides its
# own copy, "what color is this control" again has to be answered by grepping files.
#
# The criterion is **declaration count**, not "in which selector" — the latter needs CSS parsing to
# judge, while counting declarations is definite: the whole app has exactly one `accent-color: …`
# (excluding comment lines). One more means someone started another copy.
accent_n=$(grep -rn 'accent-color:' app/src 2>/dev/null | grep -v '^\s*[^:]*:[0-9]*:\s*/\*' \
  | grep -vc '^\s*$' || true)
if [ "$accent_n" != "1" ]; then
  echo "check-one-scrim: expected exactly one 'accent-color:' declaration, found $accent_n:"
  grep -rn 'accent-color:' app/src 2>/dev/null || true
  fail=1
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-scrim: one scrim source (self-test passed: a planted hand-rolled overlay goes red)."
