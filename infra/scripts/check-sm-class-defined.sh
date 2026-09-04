#!/usr/bin/env sh
# check-sm-class-defined —— every `sm-*` class written into tsx must really exist in CSS.
#
# Why this gate exists:
# This design language's action buttons all rely on `.sm-btn` + a variant (`-solid` / `-outline` /
# `-ghost` / `-accent` / `-danger`). **A misspelled variant does not error** — in tsx, className is
# a string, the mistyped half matches nothing, the browser says nothing about unknown class names,
# and neither tsc nor eslint cares about CSS.
# So the button **silently falls back to bare `.sm-btn`**: transparent background, no border, 11px
# monospace small text.
#
# It's not "a bit off in styling", it's inverted priority:
#   - `/admin/seo`'s `SAVE` carries `sm-btn-primary` (a nonexistent variant), and renders **lighter
#     than the two secondary "jump elsewhere to edit" links beside it** — design review logged it as
#     a layout issue, UX-74②, when the real cause is that this class generates not one line of CSS.
#   - `SessionStrip`'s "N / M names" uses `sm-session-strip-members-used` to emphasize the N, but the
#     only definition is `sm-session-strip-used` (the one for quota). So on the same strip, the turns
#     number is ink / alert vermillion and the names number is nothing.
#
# Same family as [[computed-class-generates-nothing]]: **the name is there, the rule isn't, and no
# tool errors**. That gate covers interpolation, this one covers **typos / never-defined**. Together
# they cover "the class generates nothing".
#
# Scan rules (each is deliberate; read before changing):
#   - Scan tsx only — className only appears there. `sm-session-changed` in a `.ts` is an event name,
#     not a class.
#   - Drop `--sm-*`: that's a CSS variable reference (`var(--sm-scrim)`), not a class name.
#   - Drop names immediately followed by `.`: a filename in a comment (`sm-components.js` / `sm-tokens.css`).
#
# Self-test (see [[gate-can-go-blind]] / [[assertion-that-cannot-fail]]):
#   the scan range must not be empty; a planted undefined class must be caught; the two exclusion
#   rules must be neither too broad nor too narrow.

set -eu

SRC=app/src

# strip_noise —— filter out things in a tsx chunk that "look like a class but aren't".
#   1. Whole-line comments (starting `//` / `*`): comments **discuss** classes — e.g. Btn.tsx
#      explaining why `sm-btn-primary` doesn't exist. className is never written in a whole-line comment.
#   2. `--sm-*`: CSS variable references.
#   3. Trailing `.`: a filename in a comment (`sm-components.js`).
strip_noise() {
  grep -vE '^[[:space:]]*(//|\*)' \
    | sed 's/--sm-[a-z0-9-]*//g' \
    | grep -oE 'sm-[a-z0-9-]+\.?' \
    | grep -v '\.$'
}

extract_used() {
  find "$SRC" -name '*.tsx' -type f -print0 2>/dev/null \
    | xargs -0 -r cat \
    | strip_noise \
    | sort -u
}

extract_defined() {
  find "$SRC" -name '*.css' -type f -print0 2>/dev/null \
    | xargs -0 -r grep -hoE '\.sm-[a-z0-9-]+' \
    | cut -c2- \
    | sort -u
}

# Process substitution `<(...)` and `grep --include` are bash/GNU features, and this gate also runs
# in the alpine image (busybox's sh/grep **silently** read them as something else — see
# [[gate-can-go-blind]]). So the whole path uses real temp files + find/xargs.
deffile=$(mktemp -t smclassdef.XXXXXX)
used=$(extract_used)
extract_defined > "$deffile"
defined=$(cat "$deffile")
missing=$(printf '%s\n' "$used" | grep -vxF -f "$deffile" || true)
rm -f "$deffile"

# ── Self-test 1: scan range ──────────────────────────────────────────────────
ntsx=$(find "$SRC" -name '*.tsx' -type f 2>/dev/null | grep -c . || true)
ndef=$(printf '%s\n' "$defined" | grep -c . || true)
if [ "$ntsx" -lt 50 ] || [ "$ndef" -lt 50 ]; then
  echo "check-sm-class-defined: SELF-TEST FAILED — $ntsx tsx / $ndef defined classes in range, the scan is blind"
  exit 2
fi

# ── Self-test 2: judgment + three exclusion rules ──────────────────────────────────────
# The four seeds' names are **mutually non-substring** — otherwise `case`'s globbing misjudges
# them against each other (the first version failed here: `sm-btn-plantedvariant` contains
# `plantedvar`, and an exclusion-rule assertion was fed green by its own seed).
plant=$(mktemp -t smclass.XXXXXX)
{
  printf '<button className="sm-btn sm-btn-plantedclass" />\n'
  printf '<div className="fixed bg-[var(--sm-seededtoken)]" />\n'
  printf '// see docs/design/project/sm-quotedpath.js:12\n'
  printf '// the two vocabularies are exactly the source of `sm-discussedname`\n'
} > "$plant"
seen=$(strip_noise < "$plant" | sort -u)
rm -f "$plant"
case "$seen" in *sm-btn-plantedclass*) ;; *)
  echo "check-sm-class-defined: SELF-TEST FAILED — planted undefined class was not seen"; exit 2 ;;
esac
case "$seen" in *seededtoken*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a --sm-* css var leaked in as a class"; exit 2 ;;
esac
case "$seen" in *quotedpath*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a filename in a comment leaked in as a class"; exit 2 ;;
esac
case "$seen" in *discussedname*)
  echo "check-sm-class-defined: SELF-TEST FAILED — a class NAMED IN A COMMENT leaked in as a use"; exit 2 ;;
esac

# ── Judgment ─────────────────────────────────────────────────────────────
if [ -n "$missing" ]; then
  echo "check-sm-class-defined: these classes are written into tsx but defined NOWHERE in css."
  echo "                        they generate not one line of CSS —— the button silently falls back to bare .sm-btn:"
  for c in $missing; do
    echo "  $c"
    find "$SRC" -name '*.tsx' -type f -print0 \
      | xargs -0 -r grep -n "$c" \
      | head -4 | while IFS= read -r l; do echo "      $l"; done
  done
  exit 1
fi

echo "check-sm-class-defined: every sm-* class in tsx has a definition ($ntsx tsx files, $ndef classes; self-test passed)."
