#!/usr/bin/env sh
# check-no-impl-words-at-visitor —— implementation vocabulary must not appear in
# visitor-visible progress copy.
#
# Why this gate exists (UX-55):
# A visitor asks "can you give me a summary I can send to my team?", and the progress
# indicator on screen replies with **`calling plugin`** — a host architecture noun.
# **The same product gets this right on the owner side**: `summarize_conversation`'s
# manifest has `title: Summarize the conversation`, the dock dropdown passes that
# straight through, and dock-buttons check 2 is exactly why it's green there.
#
# **The human-readable name was already there, it just never followed through to the
# visitor's path** ([[move-the-capability-move-its-edges]]). So the fix isn't "add
# another progress_label field for someone to fill in" — the next capability will
# forget it just the same — it's making the fallback fall back to the Title, which
# is **already required, already reviewed by the owner**.
#
# This gate guards a **class**, not that one string: nothing on the progress-label
# path may use plugin / adapter / handler / dispatch — words only an implementer
# would use.
#
# Self-test: feed a planted bad fallback into the same check; it must go red
# (see [[gate-can-go-blind]]).

set -eu

# Scan only the path that actually becomes throbber copy: the progress label's
# production point.
#
# Resolve the path relative to **repo root**, not cwd: this gate runs both from
# root (make lint) and from backend/ (backend/Makefile's connector-boundary).
# The first version hard-coded a relative path and couldn't find the file when
# run from backend/ — and it correctly reported "the rule has no subject" and
# exited 2, **it did not report green**.
# A gate that can't find its subject must blow up, never pass silently
# (see [[assertion-that-cannot-fail]]).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/backend/internal/capabilities/mcpplugin/progress_label.go"

# IMPL_WORDS —— words only someone who wrote this system would say. Fine on the
# owner side (they're configuring this stuff); **not fine on the visitor side**.
# Deliberately excludes "tool": the product does call it a tool on the visitor
# side ("SEARCHED 2 · READ 5" in the receipt) — that's already a considered
# vocabulary choice, not a leaked implementation detail.
IMPL_WORDS='plugin|adapter|handler|dispatcher|dispatch|binding|manifest|sandbox|rpc'

fail=0

# scan —— inside the progress-label function body, find lines whose **returned
# literal itself** carries an implementation word.
#
# The check must look only at **line content**, never the filename together with
# it: the first version glued `FILENAME:FNR:line` together and grepped that, and
# this file lives under `internal/capabilities/mcpplugin/` — **the path itself
# contains "plugin"** — so every line matched, including the correct
# `return "working"`, which also went red.
# It's easier to get the match target wrong than the match rule
# (same lesson as [[lookahead-rule-eats-the-neighbour]]: a rule that eats its
# neighbor). Now awk does the judging itself, looking only at $0.
scan() {
  awk -v words="$IMPL_WORDS" '
    /func ProgressLabel/  { inblock = 1 }
    inblock && /return "/ {
      line = $0
      if (tolower(line) ~ words) { print FILENAME ":" FNR ":" line }
    }
    inblock && /^}/       { inblock = 0 }
  ' "$@"
}

if [ ! -f "$TARGET" ]; then
  echo "check-no-impl-words-at-visitor: $TARGET is gone — the rule has no subject"
  exit 2
fi

offenders=$(scan "$TARGET" || true)
if [ -n "$offenders" ]; then
  echo "check-no-impl-words-at-visitor: a visitor-facing progress label names the implementation:"
  echo "$offenders"
  echo "                 what a visitor wants is \"what's happening right now\", not \"how the host implements it\"."
  echo "                 Fall back to the manifest's Title — it's required, and the owner has already reviewed it."
  fail=1
fi

# Self-test 1: the check must be able to see a planted bad fallback.
planted=$(mktemp -t implwords.XXXXXX)
cat > "$planted" <<'PLANTED'
func ProgressLabel(m *Manifest, declared string) string {
	return "calling plugin"
}
PLANTED
if [ -z "$(scan "$planted" || true)" ]; then
  rm -f "$planted"
  echo "check-no-impl-words-at-visitor: SELF-TEST FAILED — the scan cannot see a planted impl word"
  exit 2
fi
rm -f "$planted"

# Self-test 2: the check must not red a **good** fallback — a gate scoped too
# wide pushes the code somewhere worse (see [[gate-scope-forces-architecture]]).
ok=$(mktemp -t implwords-ok.XXXXXX)
cat > "$ok" <<'OKCASE'
func ProgressLabel(m *Manifest, declared string) string {
	return "working"
}
OKCASE
if [ -n "$(scan "$ok" || true)" ]; then
  rm -f "$ok"
  echo "check-no-impl-words-at-visitor: SELF-TEST FAILED — the scan reds a legitimate fallback"
  exit 2
fi
rm -f "$ok"

[ "$fail" -eq 0 ] || exit 1
echo "check-no-impl-words-at-visitor: no implementation vocabulary on the visitor's progress line (both self-tests passed)."
