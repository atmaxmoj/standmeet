#!/usr/bin/env bash
# check-core-seals-only.sh —— §1.5: the kernel seals, it never unseals.
#
# A sealed credential is unsealed by the layer that **owns the sealed column and immediately
# spends it** —— the connector layer does exactly that (internal/connector/connection_repo.go
# decrypts a token right where the row is read, and the plaintext never leaves). The kernel is
# not such a layer: it holds no credential storage, so any decryption there means a ciphertext
# plus the key to open it were both handed to code whose job is neither.
#
# go-arch-lint cannot see this. A kernel file that takes a `func([]byte) ([]byte, error)` from
# the composition root imports nothing illegal —— every arrow is green while the kernel is doing
# the one thing it must not do. So this is a string ratchet over the kernel packages, same shape
# as check-core-agnostic.sh.
#
# The baseline backend/.core-seals-only-baseline records the **currently declared** exceptions
# (each line "file<TAB>text", sorted):
#   - a new hit outside the baseline      → red (the kernel grew a new way to unseal)
#   - a baseline entry no longer scanned  → red (delete it; the baseline can only shrink)
# Shrink it to empty → delete the baseline file → the guard enters pure-red mode.
#
# The single exception today is the AI provider key: cmd/server injects a cryptobox.Decrypt
# closure as inference.KeyDecrypter, and the resolver opens owners.ai_provider_key_enc itself.
# Draining it means deciding where that unsealing belongs (making the AI provider a connector,
# or unsealing in the owner repo that owns the column) —— that decision is the point of the
# baseline: it names the exception instead of letting it pass unnamed.
#
# Excluded: _test.go, and comment lines starting with `//` or `*`.
#
# Usage:
#   check-core-seals-only.sh          check (default). Exit 0=clean, 1=violations.
#   check-core-seals-only.sh seed     print the current hit set (use it to write the baseline).
#
# Self-test in check-core-seals-only-test.sh: plant a decrypting kernel file → assert red.

set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE="backend/.core-seals-only-baseline"

# The kernel packages —— same set as check-core-agnostic.sh. Everything else (the connector
# layer, the repos that own the sealed columns, the composition root) may unseal.
CORE_DIRS="backend/internal/conversation/inference backend/internal/capabilities"

# What unsealing looks like. Catches the direct call (cryptobox.Decrypt / Unseal) **and** the
# indirect form (a decrypter function injected from outside and invoked here) —— the indirect
# form is the one that got past every import-arrow check.
PATTERN='[Dd]ecrypt|[Uu]nseal'

# current_hits —— file<TAB>trimmed source, for every non-comment kernel line that unseals.
# **No line number in the key**: an unrelated edit higher up the file would shift it and go red,
# and a guard that cries wolf teaches you to re-seed without reading. The file is in the key, so
# moving the exception to another kernel file still has to be re-declared.
current_hits() {
  find $CORE_DIRS -name '*.go' ! -name '*_test.go' 2>/dev/null | sort | while IFS= read -r f; do
    [ -f "$f" ] || continue
    # `|| true` on both greps: "no match" is exit 1, and under `set -e` + pipefail that would
    # kill the scan on the first clean file —— i.e. a clean kernel would look like a crash.
    { grep -E "$PATTERN" "$f" 2>/dev/null || true; } \
      | { grep -vE '^[[:space:]]*(//|\*)' || true; } \
      | while IFS= read -r hit; do
          text=$(printf '%s' "$hit" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
          printf '%s\t%s\n' "$f" "$text"
        done
  done | sort -u
}

# guard against a blind scanner —— an empty CORE_DIRS or a broken find would report "clean"
# forever. Assert the kernel is actually being read before trusting a green.
scanned=$(find $CORE_DIRS -name '*.go' ! -name '*_test.go' 2>/dev/null | wc -l | tr -d ' ')
if [ "$scanned" -eq 0 ]; then
  echo "check-core-seals-only: scanned 0 kernel files — the scanner is blind, not the kernel clean." >&2
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
  echo "check-core-seals-only: the kernel unseals something new (outside the baseline)." >&2
  echo "The kernel seals; it never unseals. Unseal where the sealed column lives and is spent" >&2
  echo "(the connector layer / the owning repo), and hand the kernel what it can use, not the key:" >&2
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
  echo "check-core-seals-only: $scanned kernel files scanned; the kernel unseals nothing beyond the $n declared exception line(s)."
fi
exit "$rc"
