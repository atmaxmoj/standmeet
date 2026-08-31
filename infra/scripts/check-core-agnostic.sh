#!/usr/bin/env bash
# check-core-agnostic.sh —— #135 structure-lock Layer 4: kernel zero-capability (string ratchet).
#
# Any **concrete capability/connector** name inside the kernel (CORE_DIRS) = a leak. go-arch-lint
# only tracks the import arrows between packages. It cannot catch "a kernel file wrote booking
# logic in the same package" (such a file only imports legal packages, all arrows green). This
# guard covers that blind spot with a string ratchet —— plan Part 0 Layer 4.
#
# **The baseline is drained and deleted —— this guard is in pure-red mode**: any concrete
# capability name in a kernel package is red, with nothing grandfathered. The last entry was
# `agent_instruction.go<TAB>calendar`: the always-on datetime context told every visitor that
# "the owner's calendar runs in this timezone" and to confirm their zone "before proposing or
# scheduling times" —— a scheduling instruction carried by visitors who had no booking tool at
# all. The kernel now states only facts (the time, its zone, the visitor's zone when known);
# what to do about those zones lives in the booking capability's own MCP instructions.
#
# Re-seeding backend/.core-agnostic-baseline (each line "file<TAB>token", sorted) would put it
# back into ratchet mode:
#   - a new hit outside the baseline      → red (no new leaks —— this is "it holds even if the AI forgot the structure")
#   - a baseline entry no longer scanned  → red (forces you to delete it from the baseline; the baseline can only shrink)
# Each drain trims the baseline; shrink it to empty → delete the file again → back to pure red.
#
# Excluded: _test.go, and comment lines starting with `//` or `*`. CORE_DIRS holds only the three
# kernel packages; the connector layer (internal/connector*), postgres, mailer, the composition
# root (cmd/server), the owner-side cap bundles (internal/owner/{ownercore,jobs}), and mcp-servers/ are **not** the
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
# access/entity + owner/entity 是 2026-08-31 加进来的。
#
# 加它们的原因是一次真实的泄漏：job loop（一个**插件**）要的 `hiring` role 和 prompt
# 被写进了 `access/entity`，紧挨着 `PublicRoleName` / `InvitedRoleName` —— 内核于是
# 认识了一个插件的词，而那条 role 还带着一条只有插件说得清的 glob。
# 那一版 `make lint` 是**绿的**：这两个包当时不在 CORE_DIRS 里，锁结构上看不见。
#
# 而它们恰恰是最该锁的：`access/entity` 定义访问层级，`owner/entity` 定义 owner 的
# 值对象 —— 插件想在内核里"占个名分"，第一个落脚点就是这两处。
CORE_DIRS="backend/internal/conversation/inference backend/internal/capabilities \
backend/internal/access/entity backend/internal/owner/entity"

# Concrete capability/connector names. All are words with "almost zero legitimate reason" in the kernel. Deliberately excluded:
#   - bare "mail"/"email"/"google"/"corpus" —— email is identity, corpus is a kernel primitive; catching them would
#     hurt future legitimate kernel code. mail catches only camelCase Mail[A-Z] and mail. (MailProxy/MailSender/mail.X).
# ask_visitor / askvisitor —— the leaf capability the list used to miss entirely. Its self-test
# probe went straight through the guard: a guard only sees the words it lists, and "it caught
# calendar" says nothing about the other four. Both spellings, because the match is per-token and
# case-insensitive: `ask_visitor` catches the id, `askvisitor` catches AskVisitor / askVisitor.
# Every shipped leaf capability now has a probe in the self-test — add a capability, add its word.
TOKENS="calendar caldav freebusy booking booker smtp gcal retrieval summarize summarise ask_visitor askvisitor"

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
  if [ -f "$BASELINE" ]; then
    echo "check-core-agnostic: kernel clean against baseline ($n known-leak entries, ratchet holds)."
  else
    # No baseline file = nothing grandfathered. Say so —— "clean against baseline" would read
    # as if some leaks were still being tolerated.
    echo "check-core-agnostic: kernel names no concrete capability (pure-red mode, no baseline)."
  fi
fi
exit "$rc"
