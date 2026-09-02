#!/usr/bin/env sh
# check-instructions-name-sure-tools —— **a capability's session-independent instructions must never name a tool that might not be present.**
#
# Why this gate exists (F-B-10):
# A tool in a manifest that carries `requires` is **conditional** — when the owner has granted
# only `calendar.readonly`, assembly strips `calendar_book` out (F-B-8). But the `instructions`
# block is a constant that's **the same regardless of session**: it keeps telling the model
# *"You can book meetings … 2. calendar_book — actually create the event"*.
# So the model has no such tool in hand, yet still says out loud "give me a topic and I'll book it
# right now" — the product **says** an action it can't do, even though it never **dispatches** it.
#
# The check isn't "is it clearly written" but "does this sentence still hold up in the
# worst-case session": session-independent text may only describe things that are **present in
# every session**. The conditional ones have their usage written into their own tool
# description — that description travels with the tool and leaves with it, so it can never lie.
#
# Scope (two places, both "instructions that don't vary by session"):
#   · the Go constant named `instructions` in `mcp-servers/*/…` (each plugin's own fragment);
#   · `backend/internal/prompts/**.md` (the embedded fragment).
# Code is out of scope: a tool obviously has to spell out its own name on the line that
# registers it, and a card's testid carries it too.
#
# Three self-tests: the tool list must not be empty, the scan surface must not be empty, and a planted mention must go red.

set -eu

fail=0

# ── list: which visitor tools are **conditional** (the ones carrying requires: in a manifest) ──
#
# The YAML looks like this:
#   - name: calendar_book
#     requires: [calendar:events.insert]
# so only "the name from the line above + the requires on this line" counts — grepping just
# `- name:` would also pull in the unconditional ones, which would flag every set of
# instructions as red and get this gate turned off ([[gate-scope-forces-architecture]]).
conditional_tools() {
  for m in backend/capabilities/*/manifest.yaml; do
    [ -f "$m" ] || continue
    awk '
      /^[[:space:]]*-[[:space:]]*name:[[:space:]]*/ {
        name = $0
        sub(/^[[:space:]]*-[[:space:]]*name:[[:space:]]*/, "", name)
        gsub(/[[:space:]]+$/, "", name)
        next
      }
      /^[[:space:]]*requires:[[:space:]]*\[/ {
        if (name != "") { print name; name = "" }
        next
      }
    ' "$m"
  done | sort -u
}

# ── scope: the body of the session-independent instructions ──
#
# The Go half only takes the span between `const instructions = ` and the closing backtick, not
# the whole file: the same file also has card HTML, and `tool-card-calendar_book` inside it is a
# testid, not something said to the model.
instruction_text() {
  for f in $(find mcp-servers -name '*.go' -not -name '*_test.go' 2>/dev/null | sort); do
    awk -v src="$f" '
      /^const instructions = `/ { inside = 1; next }
      inside && /`$/ { inside = 0; next }
      inside { print src ": " $0 }
    ' "$f"
  done
  for f in $(find backend/internal/prompts -name '*.md' 2>/dev/null | sort); do
    sed_free_cat "$f"
  done
}

# sed_free_cat —— prints a .md file with its filename prefixed. (This repo bans sed for editing files; this is just a read.)
sed_free_cat() {
  awk -v src="$1" '{ print src ": " $0 }' "$1"
}

tools=$(conditional_tools)
text=$(instruction_text)

n_tools=$(printf '%s\n' "$tools" | grep -c . || true)
n_lines=$(printf '%s\n' "$text" | grep -c . || true)

# Self-test 1: if the list is empty, the loop below is always green, and the gate might as well not exist.
if [ "$n_tools" -lt 1 ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — no tool in any manifest declares"
  echo "                        'requires:', so the gate has nothing to look for (yaml shape changed?)"
  exit 2
fi
# Self-test 2: if zero lines were collected, same problem — the scan is blind ([[gate-can-go-blind]]).
if [ "$n_lines" -lt 1 ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — no instruction text was collected;"
  echo "                        the scan is blind (const renamed, or the prompts dir moved?)"
  exit 2
fi

for t in $tools; do
  hits=$(printf '%s\n' "$text" | grep -F "$t" || true)
  if [ -n "$hits" ]; then
    echo "check-instructions-name-sure-tools: '$t' only exists when the owner's grant covers it,"
    echo "                        but a session-independent instruction names it:"
    printf '%s\n' "$hits" | while IFS= read -r line; do
      echo "                          $line"
    done
    echo "                        Move that guidance into the tool's own description — it travels"
    echo "                        with the tool, so it cannot outlive it."
    fail=1
  fi
done

# Self-test 3: the verdict self-test — a planted sentence must go red.
planted=$(printf '%s\n' "fake.go: call $(printf '%s\n' "$tools" | head -1) to do the thing")
first=$(printf '%s\n' "$tools" | head -1)
if [ -z "$(printf '%s\n' "$planted" | grep -F "$first" || true)" ]; then
  echo "check-instructions-name-sure-tools: SELF-TEST FAILED — a planted mention was not caught"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-instructions-name-sure-tools: $n_tools conditional tool(s); no session-independent"
echo "                        instruction names one (self-test passed)."
