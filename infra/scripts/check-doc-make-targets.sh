#!/usr/bin/env sh
# check-doc-make-targets —— **any `make X` printed in code style in the docs must actually run.**
#
# Why this gate exists:
# The project's own rule is "all Docker / test operations go through the Makefile; no recipe
# means add one first". So a doc wrote `make capture-job-fixtures`, a reader (human or agent)
# typed it — and got `No rule to make target`. That recipe was never added, even though the
# script sits right there at `e2e/fixtures/job-boards/capture.sh`. The result:
# **the rule pointed the only compliant entry point at a door that doesn't exist**, so anyone
# who actually wants to do that has to bypass the rule and run the script raw.
# The first run of this gate caught four: capture-job-fixtures / trim-job-fixtures / backup /
# restore — the scripts all exist for every one of them, only the wrapper line is missing.
#
# The check is "does the Makefile declare this target or not".
#
# **Do not probe with `make -n <t>`** (the first version did, and it timed out): under `-n`
# GNU make **still executes** any recipe line containing `$(MAKE)` — that's how make can print
# its own sub-commands too. And this repo's `test:` recipe is one single line joined with `\`,
# containing both `pnpm exec playwright test` and `$(MAKE) archive-failures`. So
# `make -n test` **actually runs the whole e2e suite**. A probe that only wants to ask
# "does this target exist" must never have a chance of running a production recipe.
#
# The cost is that this script has to recognize Makefile target lines itself. So it carries
# self-tests below: it must recognize a known target, must not recognize a known non-target,
# must not report zero references, and must actually follow the Makefile's `include` lines —
# it used to refuse to run at all once the Makefile grew one, because it could not see in.
#
# What about proposals: it's legitimate for a doc to discuss a target that **doesn't exist
# yet** ("we'll need a `make verify-fixtures` eventually"). That sentence must carry the
# marker `(not built yet)` on the same line — **one word, one meaning**, no synonyms accepted —
# otherwise "to add / planned / TODO / recommended" all get written differently, and the gate
# ends up either blind or over-triggering, and eventually gets turned off.
#
# Self-test: a nonexistent target must be judged missing; an existing target must be judged
# present; scanning zero references must be reported as a failure (scope went blind).

set -eu

fail=0
# The marker only recognizes this **phrase**; whatever comes after it in parens is free
# (`(not built yet — this half is the negated one)` still counts). The first version also
# required the closing paren, so a line with extra explanation after it went unrecognized —
# the marker must recognize the meaning, not the punctuation.
MARKER='not built yet'
MAKEFILE=Makefile

# Includes. This used to fail outright on any `include`, because the target table below read
# one file and an include could define targets somewhere it never looked. Failing loudly was
# the right answer to being blind — but the better answer is to stop being blind, so the scan
# now follows includes and reads those files too.
#
# An include of an env file (variables, no targets) therefore contributes nothing and is fine,
# which is what `-include .dev-stack.env` is. An include that does define targets is seen. An
# include whose file is absent contributes nothing, which is exactly what `-include` means.
included=$(grep -E '^[[:space:]]*(-|s)?include[[:space:]]' "$MAKEFILE" \
  | awk '{ for (i = 2; i <= NF; i++) print $i }' || true)
scan_files="$MAKEFILE"
for inc in $included; do
  [ -f "$inc" ] && scan_files="$scan_files $inc"
done

# read_targets —— the target names in the given files. The name(s) at the start of a line,
# several allowed before the colon (`a b:`), excluding variable assignments (`a := x`).
read_targets() {
  grep -hE '^[a-zA-Z0-9_.%/-]+([[:space:]]+[a-zA-Z0-9_.%/-]+)*:([^=]|$)' "$@" \
    | awk -F: '{print $1}' | tr ' ' '\n' | grep -v '^$' | sort -u
}

targets=$(read_targets $scan_files)

# Self-test, both halves. The first version only had the second, and it could not fail for the
# thing that matters: it called read_targets with an explicit extra file, so sabotaging the
# loop that BUILDS scan_files left it green. A self-test has to walk the same path the real
# scan walks.
#
# Half one: every included file that exists is actually in the scan list.
for inc in $included; do
  [ -f "$inc" ] || continue
  case " $scan_files " in
    *" $inc "*) ;;
    *)
      echo "check-doc-make-targets: SELF-TEST FAILED — included file $inc exists but is not in"
      echo "                        the scan list; targets defined there would be invisible."
      exit 2
      ;;
  esac
done

# Half two: read_targets can see a target in a second file at all. Half one is vacuous in a
# checkout with no included files present, and this half is not.
probe_inc="${TMPDIR:-/tmp}/doc-make-targets-include-probe.mk"
printf 'probe-target-from-include:\n\t@true\n' > "$probe_inc"
if ! read_targets "$MAKEFILE" "$probe_inc" | grep -qx 'probe-target-from-include'; then
  echo "check-doc-make-targets: SELF-TEST FAILED — a target defined in an included file was not"
  echo "                        found; the include scan is not working and this gate is blind."
  rm -f "$probe_inc"
  exit 2
fi
rm -f "$probe_inc"

target_exists() {
  printf '%s\n' "$targets" | grep -qx "$1"
}

# Scope uses git grep (only looks at **tracked** files) — node_modules holds hundreds of
# third-party READMEs full of `make release` / `make build-browser`; scanning by directory
# would get flooded by those, and this gate would end up needing an exemption list.
# Not `ls-files | xargs grep`: BSD xargs has no `-r`, so an empty input leaves grep
# hanging on stdin forever (the first version timed out this way).
#
# Only recognizes calls inside **code style**: a backtick-led `make x`. Prose like
# "make sure" / "make it" isn't a command — the first version didn't narrow this down,
# and 148 of 156 "targets" turned out to be plain English words.
refs=$(git grep -nE '`make [a-z][a-zA-Z0-9_-]*' -- '*.md' 2>/dev/null || true)

# Judge each one. Read with printf line-by-line rather than for-in, so filenames or
# text containing spaces don't get chopped apart.
printf '%s\n' "$refs" | while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  case "$ref" in *"$MARKER"*) continue ;; esac
  loc=${ref%%:*}
  rest=${ref#*:}
  lineno=${rest%%:*}
  for t in $(printf '%s' "$ref" | grep -oE '`make [a-z][a-zA-Z0-9_-]*' | awk '{print $2}'); do
    if ! target_exists "$t"; then
      echo "check-doc-make-targets: $loc:$lineno prints \`make $t\` — no such target."
      echo "                        add the recipe, or mark that line $MARKER if it is a proposal."
      echo "$loc:$lineno" >> "${TMPDIR:-/tmp}/doc-make-targets.fail"
    fi
  done
done

# The while loop runs in a subshell, so `fail` can't escape it — count via a file on disk
# instead ([[write-with-no-receipt]]: never let "no error" pass for "no problem").
FAILFILE="${TMPDIR:-/tmp}/doc-make-targets.fail"
if [ -f "$FAILFILE" ]; then
  fail=$(grep -c . "$FAILFILE" || echo 1)
  rm -f "$FAILFILE"
else
  fail=0
fi

# Self-test on scan coverage: if zero references got picked up, the loop above would
# always pass.
n=$(printf '%s\n' "$refs" | grep -c . || true)
if [ "$n" -lt 5 ]; then
  echo "check-doc-make-targets: SELF-TEST FAILED — only $n backticked \`make …\` reference(s)"
  echo "                        found across tracked *.md; the scan is blind."
  exit 2
fi

# Self-test on the verdict (both directions needed): a nonexistent target must be judged
# missing, an existing target must be judged present.
if target_exists definitely-not-a-target; then
  echo "check-doc-make-targets: SELF-TEST FAILED — a nonexistent target was judged to exist"
  exit 2
fi
for known in lint test dev-up; do
  if ! target_exists "$known"; then
    echo "check-doc-make-targets: SELF-TEST FAILED — \`make $known\` is declared in $MAKEFILE"
    echo "                        but the target scan missed it."
    exit 2
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "check-doc-make-targets: $n \`make …\` reference(s) in docs, all resolve (self-test passed)."
