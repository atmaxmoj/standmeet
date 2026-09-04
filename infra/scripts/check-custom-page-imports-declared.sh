#!/usr/bin/env sh
# check-custom-page-imports-declared —— what the panel says you can import, you must really be able to import.
#
# **Why this gate exists**: when the owner writes a page in the panel, which packages are available is
# **knowable only by reading `builder/vendor/`** — the screen says not one word (the owner hit this
# themselves on 2026-08-30: "I want to reference our chat feature, I have no idea what to write"). The
# fix is to list them on the panel.
#
# And "listing them" immediately creates a second copy of the fact: the list on the panel, and what
# builder actually vendors. The two drift, and in the worst direction — the panel says it's available,
# the build reports module not found, and the owner thinks they wrote it wrong. This is exactly the
# ledger of [[one-source-per-ui-primitive]].
#
# So the gate guards one direction: **every @standmeet/* package the panel mentions, builder must have
# vendored.** The reverse isn't guarded — vendored but not advertised on the panel is a tradeoff, not
# a defect.

set -eu

PANEL="app/src/lib/admin/custom-page-imports.ts"
VENDOR="builder/vendor/@standmeet"

[ -f "$PANEL" ] || { echo "check-custom-page-imports-declared: $PANEL is gone; the gate has no object"; exit 2; }
[ -d "$VENDOR" ] || { echo "check-custom-page-imports-declared: $VENDOR is gone; the gate has no object"; exit 2; }

# The package names the panel advertises. Use grep -o to take the whole @standmeet/xxx, not
# classifying by "the next character" ([[lookahead-rule-eats-the-neighbour]]).
advertised=$(grep -o '@standmeet/[a-z0-9-]*' "$PANEL" | sort -u)
[ -n "$advertised" ] || {
  echo "check-custom-page-imports-declared: $PANEL mentions no @standmeet/* at all."
  echo "         the reason this gate exists is that list; an empty list means it guards nothing."
  exit 1
}

fail=0
for pkg in $advertised; do
  name=${pkg#@standmeet/}
  if [ ! -d "$VENDOR/$name" ]; then
    echo "check-custom-page-imports-declared: the panel advertises $pkg, but builder didn't vendor it"
    echo "         owner writes it as told → build module not found → they think they wrote it wrong."
    fail=1
  fi
done

# Self-test: can the gate see anything? Build a fake panel mentioning a nonexistent package, and it
# must go red ([[gate-can-go-blind]] / [[verifier-can-lie-about-its-own-coverage]]).
probe=$(mktemp -d)
printf "import '@standmeet/definitely-not-vendored';\n" > "$probe/panel.ts"
probe_hits=$(grep -o '@standmeet/[a-z0-9-]*' "$probe/panel.ts" | sort -u)
if [ "$probe_hits" != "@standmeet/definitely-not-vendored" ]; then
  echo "check-custom-page-imports-declared: SELF-TEST FAILED —— the extractor didn't read the package name in the probe"
  rm -rf "$probe"
  exit 2
fi
if [ -d "$VENDOR/definitely-not-vendored" ]; then
  echo "check-custom-page-imports-declared: SELF-TEST FAILED —— the probe package actually exists"
  rm -rf "$probe"
  exit 2
fi
rm -rf "$probe"

[ "$fail" -eq 0 ] || exit 1
echo "check-custom-page-imports-declared: every @standmeet/* the panel advertises is in builder/vendor (self-test passed)."
