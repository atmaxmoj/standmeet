#!/usr/bin/env sh
# check-one-time-format —— time has only **three** allowed formats, all living in `lib/ui/format-time.ts`.
#
# Why this gate exists (UX-46): in a single owner session, three different formats showed up across
# three surfaces —— the transcript modal `8/8/2026, 10:16:07 AM` (US locale + seconds + AM/PM), the
# dashboard's "last visit" `2026-08-07T01:09:14Z` (ISO + Z, meant for a machine), and the same page's
# heading `last refresh · now`. The cause is the same as UX-47 (five dropdown formats) / UX-59 (two
# input-box looks): **without this layer**, `toISOString().slice(0,10)` got copy-pasted four times,
# `toLocaleString()` twice.
#
# The three formats each answer a different question (how new / which moment / which day), so they're
# three functions, not one parameter with options. A new display need first asks "is it one of these
# three?"; if genuinely not, add a fourth to format-time.ts —— **do not** write one inline at the call site.
#
# This only governs **display**: `toISOString()` is correct for params/storage/comparison (that's for a
# machine), so the check is scoped to component and lib display paths —— concretely, it only looks at
# `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` / `toISOString().slice`; the first three
# can only be display, the fourth is the format that got copy-pasted four times.
#
# `Number.toLocaleString()` (adding thousands separators to a number) is not in scope —— that's not time.
# The pattern keys off **date method names** and `.slice`, not `toLocaleString` alone, or it would flag
# `rawCount.toLocaleString()` too.
#
# Self-test: all four planted bad formats must be caught, one planted number's thousands-separator must
# pass; the scan range must not be empty.

set -eu

SRC=app/src
OWNER="$SRC/lib/ui/format-time.ts"

# DOC_OWNER —— **the date on the résumé PDF**, not backend chrome. That PDF is a document printed for a
# recruiter to read; `August 13, 2026` is correct on the document, wrong in a backend list —— two
# different audiences, two different formats, so it has its own owner file. The exemption covers only
# this one file: every other file under `resume-page/` is still governed
# (see [[gate-scope-forces-architecture]]: exempting the whole directory would let through what should stay governed).
DOC_OWNER="$SRC/components/admin/resume-page/format.ts"

# PATTERN —— only recognizes date-specific methods + that copy-pasted `toISOString().slice`.
PATTERN='toLocaleDateString|toLocaleTimeString|new Date\([^)]*\)\.toLocaleString|toISOString\(\)\.slice'

scan() {
  grep -nE "$PATTERN" "$@" 2>/dev/null || true
}

files=$(find "$SRC" -name '*.tsx' -o -name '*.ts' \
  | grep -v "^$OWNER$" | grep -v "^$DOC_OWNER$" || true)
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-one-time-format: SELF-TEST FAILED — only $n source files in range, the scan is blind"
  exit 2
fi

# Self-test: all four bad formats hit, the number's thousands-separator passes through.
plant=$(mktemp -t timefmt.XXXXXX)
cat > "$plant" <<'PLANTED'
const a = d.toLocaleDateString('en-US');
const b = d.toLocaleTimeString([], { hour: '2-digit' });
const c = new Date(iso).toLocaleString();
const e = new Date(iso).toISOString().slice(0, 10);
const ok = rawCount.toLocaleString();
PLANTED
hits=$(scan "$plant" | grep -c . || true)
rm -f "$plant"
if [ "$hits" != "4" ]; then
  echo "check-one-time-format: SELF-TEST FAILED — saw $hits/4 planted formats (a number's toLocaleString must pass)"
  exit 2
fi

if [ ! -f "$OWNER" ]; then
  echo "check-one-time-format: $OWNER is gone; the rule has no owner"
  exit 1
fi

offenders=$(printf '%s\n' "$files" | xargs -r grep -nE "$PATTERN" || true)
if [ -n "$offenders" ]; then
  echo "check-one-time-format: a hand-rolled time format —— time has only three allowed formats:"
  echo "$offenders"
  echo "                       use stampDay / stampMinute / ago ($OWNER)."
  exit 1
fi

echo "check-one-time-format: one set of time formats ($n files scanned; self-test passed on all four seeds)."
