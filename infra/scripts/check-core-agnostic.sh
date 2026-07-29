#!/usr/bin/env bash
# check-core-agnostic.sh —— #135 structure-lock Layer 4: kernel zero-capability (string ratchet).
#
# Any **concrete capability/connector** name inside the kernel (CORE_DIRS) = a leak. go-arch-lint
# only tracks the import arrows between packages. It cannot catch "a kernel file wrote booking
# logic in the same package" (such a file only imports legal packages, all arrows green). This
# guard covers that blind spot with a string ratchet —— plan Part 0 Layer 4.
#
# The ratchet baseline backend/.core-agnostic-baseline records the **currently known** leaks (each
# line "file<TAB>token", sorted):
#   - a new hit outside the baseline      → red (no new leaks —— this is "it holds even if the AI forgot the structure")
#   - a baseline entry no longer scanned  → red (forces you to delete it from the baseline; the baseline can only shrink)
# Each drain trims the baseline; shrink it to empty → delete the baseline file → the guard enters pure-red mode (any hit is red).
#
# Excluded: _test.go, and comment lines starting with `//` or `*`. CORE_DIRS holds only the three
# kernel packages; the connector layer (internal/connector*), postgres, mailer, the composition
# root (cmd/server), plugin leaves (internal/plugins/<cap>), and mcp-servers/ are **not** the
# kernel —— capability names there are legal.
#
# Usage:
#   check-core-agnostic.sh          check (default). Exit code 0=clean, 1=has violations.
#   check-core-agnostic.sh seed     print the current hit set (use it to write/update the baseline file).
#
# Self-test in check-core-agnostic-test.sh: seed a "calendar" file into the kernel → assert it goes red → remove it → goes green.

set -euo pipefail
cd "$(dirname "$0")/../.."

BASELINE="backend/.core-agnostic-baseline"

# The kernel packages —— they must not let you infer that any concrete capability/connector exists.
# (internal/usecases was the third; it is dissolved, so the agent engine + capability axis remain.)
CORE_DIRS="backend/internal/conversation/inference backend/internal/capabilities"

# Concrete capability/connector names. All are words with "almost zero legitimate reason" in the kernel. Deliberately excluded:
#   - bare "mail"/"email"/"google"/"corpus" —— email is identity, corpus is a kernel primitive; catching them would
#     hurt future legitimate kernel code. mail catches only camelCase Mail[A-Z] and mail. (MailProxy/MailSender/mail.X).
TOKENS="calendar caldav freebusy booking booker smtp gcal retrieval summarize summarise"

# Print the current hit set (each line "file<TAB>token", sort -u).
current_hits() {
  find $CORE_DIRS -name '*.go' ! -name '*_test.go' 2>/dev/null | sort | while IFS= read -r f; do
    [ -f "$f" ] || continue
    # Strip comment lines (starting with // or *) before matching —— a word in a historical comment is not a leak.
    body=$(grep -vE '^[[:space:]]*(//|\*)' "$f" 2>/dev/null || true)
    for tok in $TOKENS; do
      if printf '%s\n' "$body" | grep -qiE -- "(^|[^a-zA-Z])$tok"; then
        printf '%s\t%s\n' "$f" "$tok"
      fi
    done
    # mail special case: catch only Mail[A-Z] / mail. —— avoid the email identity and owner.Email.
    if printf '%s\n' "$body" | grep -qE 'Mail[A-Z]|mail\.'; then
      printf '%s\t%s\n' "$f" "mail"
    fi
  done | sort -u
}

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

new=$(comm -23 "$hits_f" "$base_f")     # only in current hits → a new leak
stale=$(comm -13 "$hits_f" "$base_f")   # only in the baseline → already cleaned, the baseline should shrink

rc=0
if [ -n "$new" ]; then
  echo "check-core-agnostic: new concrete capability/connector leak in the kernel (outside the baseline)." >&2
  echo "The three kernel packages must not let you infer these capabilities exist —— move the logic to the plugin/connector layer, or reach out through a generic seam:" >&2
  printf '%s\n' "$new" | sed 's/^/  + /' >&2
  rc=1
fi
if [ -n "$stale" ]; then
  echo "check-core-agnostic: the following baseline entries are no longer scanned —— delete them from $BASELINE (the baseline can only shrink)." >&2
  echo "Run 'infra/scripts/check-core-agnostic.sh seed > $BASELINE' to re-seed:" >&2
  printf '%s\n' "$stale" | sed 's/^/  - /' >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  n=$(wc -l < "$hits_f" | tr -d ' ')
  echo "check-core-agnostic: kernel clean against baseline ($n known-leak entries, ratchet holds)."
fi
exit "$rc"
