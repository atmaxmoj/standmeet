#!/usr/bin/env sh
# check-no-native-file-input —— the file-picker button must be drawn by this
# product, not by the operating system.
#
# Why this gate exists (UX-81): `<input type="file">` draws its own
# `Choose File / No file chosen`. Its look is decided by the **operating
# system** — nothing to do with the cream-paper + vermillion + mono
# language. In the connector modal it's the one control in the whole window
# that was never designed, sitting right next to buttons that were.
#
# The real cost showed up later: after fixing that one spot, the same thing
# was still standing in two other places (the wiki entry's FILES row, a
# writing's cover image) — **one lesson only got applied where it was first
# found** ([[lesson-not-swept-to-neighbours]]). So what this locks down isn't
# "remember to hide it" but "if you can't hide it, you can't write it": the
# only legal way to write one is the FilePicker atom
# ([[structure-means-no-responsibility-class]]).
#
# **Shape of the check**: within 6 lines after a `type="file"` line, either
# `sr-only` or `className="hidden"` must appear.
# A native input hidden visually is **the legitimate way to do it** —
# ObsidianBar's vault-directory picker works exactly like this: the input is
# hidden, and a real Btn sits next to it. This rule governs **a visible
# native control**, not "you must use a specific component". It's drawn on
# "visible or not" rather than "is it a FilePicker" so a legitimate use like
# webkitdirectory isn't pushed somewhere worse
# ([[gate-scope-forces-architecture]]).
#
# Self-test: plant a bare one, it must judge red; plant an sr-only one and a
# className="hidden" one, both must pass through.

set -eu

OWNER="app/src/components/admin/atoms/FilePicker.tsx"
WINDOW=6

fail=0

# scan_native —— finds "a visible native file input". Comment lines are
# skipped: some files' header comments are telling this exact history, and
# judging them red would force someone to delete the explanation.
scan_native() {
  awk -v w="$WINDOW" '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    { buf[FNR] = $0 }
    /type="file"/ { hit[FNR] = 1 }
    END {
      for (k in hit) {
        # k is the array index — awk hands it back as a **string**. Without
        # +0, `"6" <= 12` does string comparison ("6" > "12"), the window
        # never expands, and even a properly hidden input judges red. This
        # is exactly what the self-test caught.
        n = k + 0
        hidden = 0
        for (i = n; i <= n + w; i++) {
          if (buf[i] ~ /sr-only/ || buf[i] ~ /className="hidden"/) { hidden = 1 }
        }
        if (!hidden) { print FILENAME ":" n ":" buf[n] }
      }
    }
  ' "$1"
}

scan_all() {
  for f in "$@"; do scan_native "$f"; done
}

files=$(find app/src sdk -name '*.tsx' -type f 2>/dev/null | grep -v node_modules || true)

# 1) The scanner must actually see the files — an empty list would make the
#    check below always green ([[assertion-that-cannot-fail]]), the same
#    failure mode as the time `grep --include` went silently blind on alpine
#    ([[gate-can-go-blind]]).
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 50 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — only $n tsx files found, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files is a newline-separated path list; word splitting is intended here
offenders=$(scan_all $files || true)

if [ -n "$offenders" ]; then
  echo "check-no-native-file-input: the browser's own Choose File will show up in these places —"
  echo "$offenders"
  echo "                            use <FilePicker label=… testid=… onPick=…> ($OWNER),"
  echo "                            or hide the input (sr-only / hidden) and draw your own button."
  fail=1
fi

# 2) The atom must still exist, and it must actually be the one hiding its
#    input — otherwise the check above has no landing point.
if [ ! -f "$OWNER" ]; then
  echo "check-no-native-file-input: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q 'sr-only' "$OWNER"; then
  echo "check-no-native-file-input: $OWNER no longer hides its input — this rule's only correct answer stopped working"
  fail=1
fi

# 3) Self-test: one red, two green. A gate that only verifies red has never verified its own boundary.
guilty=$(mktemp -t filecheck.XXXXXX)
cat > "$guilty" <<'PLANTED'
export function Bad() {
  return <input type="file" accept="image/*" className="mono text-[11px]" />;
}
PLANTED
innocent=$(mktemp -t filecheck.XXXXXX)
cat > "$innocent" <<'PLANTED'
export function Hidden() {
  return (
    <label className="sm-btn">
      pick
      <input
        type="file"
        accept=".json"
        className="sr-only"
      />
    </label>
  );
}
export function AlsoHidden({ inputRef }) {
  return <input ref={inputRef} type="file" multiple className="hidden" />;
}
PLANTED
guilty_hits=$(scan_native "$guilty" | grep -c . || true)
innocent_hits=$(scan_native "$innocent" | grep -c . || true)
rm -f "$guilty" "$innocent"
if [ "$guilty_hits" -ne 1 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — expected 1 planted offender, saw $guilty_hits"
  exit 2
fi
if [ "$innocent_hits" -ne 0 ]; then
  echo "check-no-native-file-input: SELF-TEST FAILED — a visually hidden input must be let through, saw $innocent_hits"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-no-native-file-input: every file picker is one this product drew ($n tsx files scanned; self-test passed)."
