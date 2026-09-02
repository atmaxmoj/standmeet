#!/usr/bin/env sh
# check-one-text-input —— a text input has **one** look, and that look has one source:
# `.sm-field-input`.
#
# Why this gate exists (UX-59): the same kind of control grew two looks in this product —
# connector credentials, connector op params, and the two SEO fields are **fully boxed**
# (border on all four sides + rounded corners + padding), while the codes new-code modal,
# the resume composer, gate, and the AI provider panel use **underline** inputs. The owner
# hits a different standard every other screen.
#
# This is the same failure shape as UX-47 (five dropdown spellings), and that one's lesson
# was: **having one class isn't enough**. `.sm-field-input` existed the whole time; whoever
# wrote a new input didn't know it existed, so each one decided its own look. So this gate
# does not lock "was the class applied" — it locks **"was it bypassed"**.
# (See [[reframes-tasks-into-enforced-invariants]]: make the mistake impossible.)
#
# **The first version only blocked "hand-rolled boxes", so "hand-rolled underlines" walked
# right past it** (UX-87): `/admin/roles` had five inputs each writing
# `border-b border-(--color-rule)`, which looks like the class but isn't it — the five were
# already mutually inconsistent (`/60` border vs not, `py-1` vs `py-0.5`, three different
# font sizes), and **none of them had a focus state**: `.sm-field-input:focus` turns the
# bottom edge ink-colored, and the five hand-rolled ones did nothing on click. A gate that
# blocks the same class of code twice means the missing thing is a mechanism, not a reminder
# ([[gate-blocks-twice-means-missing-mechanism]]); so this version locks **the class itself**:
# every text `<input>` must carry `sm-field-input`, and the look may not be hand-written again.
#
# Only governs `<input>`, not cards/containers — `border … rounded` is correct on a card;
# this rule targets **input controls only**. The match window runs from `<input` to the
# closing `/>` or `>` (JSX attributes often span lines).
#
# Exceptions:
#   - A read-only display box (`readOnly`) is not an input — it's "print a value for you to
#     copy", and a box is the right look for that.
#   - `type="checkbox"` / `type="radio"` / `type="file"` are not text fields; they never had
#     that bottom edge.
#   - Elements with no `className` (test stubs, hidden fields) are out of scope for "look".
#
# Self-test: both the boxed and the hand-rolled-underline hand-rolls must go red; readOnly
# and checkbox must pass; the scan range must not be empty (see [[gate-can-go-blind]] /
# [[assertion-that-cannot-fail]]).

set -eu

SRC=app/src

# RULE —— the self-test and the real scan share this one matching block. If each copied its
# own, the self-test would no longer prove what the real scan runs.
RULE='
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /<input/ { collecting = 1; buf = ""; start = FNR }
  collecting { buf = buf " " $0 }
  collecting && /\/>|<\/input>/ {
    collecting = 0
    if (buf ~ /readOnly/)                        next
    if (buf ~ /type="(checkbox|radio|file)"/)    next
    if (buf ~ /className/ == 0)                  next
    if (buf ~ /sm-field-input/)                  next
    if (buf ~ /border border-\(--color-rule\)/)  { print FILENAME ":" start ": hand-rolled box"; next }
    if (buf ~ /border-b border-\(--color-rule\)/){ print FILENAME ":" start ": hand-rolled underline"; next }
  }
'

files=$(find "$SRC" -name '*.tsx' -type f 2>/dev/null || true)
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-text-input: SELF-TEST FAILED — only $n tsx files in range, the scan is blind"
  exit 2
fi

# Self-test: each hand-rolled spelling must go red once; readOnly and checkbox must each pass once.
plant=$(mktemp -t textinput.XXXXXX)
cat > "$plant" <<'PLANTED'
export function Planted() {
  return (
    <>
      <input
        type="text"
        className="w-full border border-(--color-rule) rounded-sm p-2"
      />
      <input
        type="text"
        className="w-full bg-transparent border-b border-(--color-rule) py-1"
      />
      <input
        readOnly
        value="/api/x/callback"
        className="w-full border border-(--color-rule) rounded-sm p-2"
      />
      <input
        type="checkbox"
        className="border-b border-(--color-rule)"
      />
      <input type="text" className="sm-field-input sm-mono" />
    </>
  );
}
PLANTED
hits=$(awk "$RULE" "$plant" | grep -c . || true)
rm -f "$plant"
if [ "$hits" != "2" ]; then
  echo "check-one-text-input: SELF-TEST FAILED — saw $hits/2 (a boxed AND an underlined hand-roll must go"
  echo "                      red; readOnly, checkbox and sm-field-input must pass)"
  exit 2
fi

offenders=$(printf '%s\n' "$files" | xargs -r awk "$RULE" || true)

if [ -n "$offenders" ]; then
  echo "check-one-text-input: a hand-rolled <input> look —— a text input has one look, and it has one source:"
  echo "$offenders"
  echo "                      use className=\"sm-field-input\" (add sm-mono for monospace);"
  echo "                      layout like width/alignment still goes in className, but don't hand-roll the look."
  exit 1
fi

echo "check-one-text-input: one text-input look, and it comes from sm-field-input ($n tsx files scanned;"
echo "                      self-test passed on the boxed, the underlined, the readOnly and the checkbox seed)."
