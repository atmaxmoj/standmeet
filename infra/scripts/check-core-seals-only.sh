#!/usr/bin/env bash
# check-core-seals-only.sh —— §1.5: the inward side seals; it has no way to unseal.
#
# The shape of the rule (owner's words): the AI provider reaches half-way out. On the inward
# side the owner fills the form, it gets sealed and stored, and **the inward side has no way to
# open it at all**. Opening happens on the outbound side, which opens and hands the plaintext to
# whoever spends it. That seal/open pair is not a kind of connector —— it is the base mechanism
# both sit on.
#
# Two scopes, because the invariant has two escapes and only one of them is visible:
#
#   KERNEL_DIRS —— no unsealing *vocabulary* at all. The kernel does not get to open, and it does
#     not get to hold something that opens: a struct field of type `func([]byte)([]byte,error)`
#     handed in from outside imports nothing illegal, so go-arch-lint sees an all-green graph
#     while the kernel opens whatever it is given. That was the real leak (a cryptobox.Decrypt
#     closure injected as inference.KeyDecrypter), and a guard that only looked for the crypto
#     package would have missed it.
#
#   INWARD_DIRS —— no at-rest opener (cryptobox.Decrypt). Sealing is fine and expected here:
#     the owner's form writes through it. Excluded from this scope: internal/connector (that IS
#     the outbound side —— it opens a token right where it spends it) and the crypto box itself.
#
# Out of scope on purpose: DecryptWithKey / DeriveSessionKey. That is the per-request BYOAI
# envelope keyed by the visitor's session token —— a different mechanism from the owner's at-rest
# vault, and folding the two under one word would be exactly the vocabulary drift this repo
# keeps paying for.
#
# **The baseline is drained and deleted —— this guard is in pure-red mode**: any unsealing on
# the inward side is red, full stop. The ratchet machinery below stays because it is what got us
# here (declare the exceptions, then drain them one at a time); re-seeding
# backend/.core-seals-only-baseline would put it back into ratchet mode:
#   - a new hit outside the baseline      → red (a new way to unseal grew on the inward side)
#   - a baseline entry no longer scanned  → red (delete it; the baseline can only shrink)
# Don't re-seed to make a red go away. The two openers that exist both live in cmd/server/unseal.go.
#
# Usage:
#   check-core-seals-only.sh          check (default). Exit 0=clean, 1=violations.
#   check-core-seals-only.sh seed     print the current hit set (use it to write the baseline).
#
# Self-test in check-core-seals-only-test.sh: plants both escapes, asserts both go red.

set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE="backend/.core-seals-only-baseline"

# The kernel —— same set as check-core-agnostic.sh.
KERNEL_DIRS="backend/internal/conversation/inference backend/internal/capabilities"
KERNEL_PATTERN='[Dd]ecrypt|[Uu]nseal'

# The inward side —— everything under internal/ except the outbound layer and the box itself.
INWARD_ROOT="backend/internal"
INWARD_SKIP='backend/internal/connector/|backend/internal/infra/cryptobox/'
# The opening parenthesis is required: without it, `cryptobox.DecryptWithKey(` would also match —— that's
# a session envelope, already out of scope for this rule as noted above. (A prefix false-positive, same kind as the market-skill- one.)
INWARD_PATTERN='cryptobox\.Decrypt\('

# scan_dirs <pattern> <files...> —— file<TAB>trimmed source for every non-comment matching line.
#
# **No line number in the key**: an unrelated edit higher in the file would shift it and go red,
# and a guard that cries wolf teaches you to re-seed without reading. The file is in the key, so
# moving an exception to another file still has to be re-declared.
scan_files() {
  local pattern="$1"; shift
  local f
  for f in "$@"; do
    [ -f "$f" ] || continue
    # `|| true` on both greps: "no match" is exit 1, and under `set -e` + pipefail that would
    # kill the scan on the first clean file —— i.e. a clean tree would look like a crash.
    { grep -E "$pattern" "$f" 2>/dev/null || true; } \
      | { grep -vE '^[[:space:]]*(//|\*)' || true; } \
      | while IFS= read -r hit; do
          printf '%s\t%s\n' "$f" "$(printf '%s' "$hit" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        done
  done
}

kernel_files() {
  find $KERNEL_DIRS -name '*.go' ! -name '*_test.go' 2>/dev/null | sort
}

inward_files() {
  find "$INWARD_ROOT" -name '*.go' ! -name '*_test.go' 2>/dev/null | grep -vE "$INWARD_SKIP" | sort
}

current_hits() {
  {
    # shellcheck disable=SC2046 # word splitting is the point: one arg per file
    scan_files "$KERNEL_PATTERN" $(kernel_files)
    # shellcheck disable=SC2046
    scan_files "$INWARD_PATTERN" $(inward_files)
  } | sort -u
}

# Guard against a blind scanner —— an empty dir list or a broken find would report "clean"
# forever. Assert both scopes are actually being read before trusting a green.
k=$(kernel_files | wc -l | tr -d ' ')
i=$(inward_files | wc -l | tr -d ' ')
if [ "$k" -eq 0 ] || [ "$i" -eq 0 ]; then
  echo "check-core-seals-only: scanned $k kernel / $i inward files — the scanner is blind, not the tree clean." >&2
  exit 1
fi

if [ "${1:-check}" = "seed" ]; then
  current_hits
  exit 0
fi

# ── check mode ──
hits_f=$(mktemp)
base_f=$(mktemp)
trap 'rm -f "$hits_f" "$base_f"' EXIT

current_hits > "$hits_f"
sort -u "$BASELINE" 2>/dev/null > "$base_f" || true

new=$(comm -23 "$hits_f" "$base_f")
stale=$(comm -13 "$hits_f" "$base_f")

rc=0
if [ -n "$new" ]; then
  echo "check-core-seals-only: the inward side grew a way to unseal (outside the baseline)." >&2
  echo "The inward side seals; it never opens. Open on the outbound side and hand over what can" >&2
  echo "be spent, not the key that opens it:" >&2
  printf '%s\n' "$new" | sed 's/^/  + /' >&2
  rc=1
fi
if [ -n "$stale" ]; then
  echo "check-core-seals-only: these baseline entries are no longer scanned — delete them from $BASELINE (the baseline can only shrink)." >&2
  echo "Run 'infra/scripts/check-core-seals-only.sh seed > $BASELINE' to re-seed:" >&2
  printf '%s\n' "$stale" | sed 's/^/  - /' >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  n=$(wc -l < "$hits_f" | tr -d ' ')
  echo "check-core-seals-only: $k kernel + $i inward files scanned; $n declared exception line(s) left to drain."
fi
exit "$rc"
