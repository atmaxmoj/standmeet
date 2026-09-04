#!/usr/bin/env sh
# lint-if-dirty —— run `make lint`, but **only once per identical tree**.
#
# Why this mechanism exists (the 2026-08-18 efficiency review): a full lint takes 3–9 minutes (saw
# 552 seconds today), and it gets run **at least twice** per commit — I run it once to confirm green,
# then `pre-commit` runs the same thing again, same tree, same result. 6 of tonight's 11 commits had
# this shape, about 30 minutes of pure waiting.
#
# **Writing a rule doesn't work**: "remember not to run it twice" is discipline a person has to hold,
# and the batching rule written into CLAUDE.md last night had already regressed tonight
# ([[structure-means-no-responsibility-class]]: a check that needs human upkeep is a responsibility
# class). So this switches to **structure**: when lint passes, write the tree fingerprint to disk, and
# next time the fingerprint matches, pass straight through. Forgetting or not is the same — the
# duplicate run removes itself.
#
# What the fingerprint takes: `git status --porcelain` + the hashes of all tracked files
# (`git ls-files -s`).
#   - Covers any content change to tracked files (ls-files -s carries the blob hash)
#   - Covers added/deleted/untracked (porcelain)
#   - Does **not** cover .gitignore'd things (node_modules, build artifacts) — those don't affect the
#     lint verdict
#
# Escape hatch: `FORCE_LINT=1 make lint-cached` forces a rerun (use it when the toolchain changed, or
# the lint script itself changed and happens not to be git-tracked).

set -eu

CACHE_DIR="${TMPDIR:-/tmp}/standmeet-lint-cache"
mkdir -p "$CACHE_DIR"

# tree_fingerprint —— the content fingerprint of this tree right now.
tree_fingerprint() {
  {
    git ls-files -s
    git status --porcelain --untracked-files=all
  } | shasum -a 256 | cut -d' ' -f1
}

fp=$(tree_fingerprint)
stamp="$CACHE_DIR/$fp"

if [ "${FORCE_LINT:-}" = "1" ]; then
  echo "lint-if-dirty: FORCE_LINT=1 —— ignoring cache, full rerun"
elif [ -f "$stamp" ]; then
  echo "lint-if-dirty: lint already passed on this tree ($(cat "$stamp")), content unchanged, skipping."
  echo "               force a rerun: FORCE_LINT=1 make lint-cached"
  exit 0
fi

make lint

# Only write to disk on a real pass —— `set -e` guarantees a failure can't reach here.
date '+%H:%M:%S' > "$stamp"
# Keep only the last 20, so /tmp doesn't grow without bound.
ls -t "$CACHE_DIR" | tail -n +21 | while read -r old; do rm -f "$CACHE_DIR/$old"; done
