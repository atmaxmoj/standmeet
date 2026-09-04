#!/usr/bin/env sh
# check-one-empty-state —— an admin list empty state may come only from ListPane.
#
# Why this gate exists (F-N-7): before it, each section wrote its own
#     hook.list.length === 0 ? <empty/> : <list/>
# This statement has only two outcomes, but the real world has three — **after a fetch fails the list
# is also an empty array**, so failure wears the empty state's clothes. What that looked like when
# driven on prod: `/admin/roles` printed "No roles yet" while that instance had three roles;
# `/admin/ip-bans` worse still — "No IPs banned. The public surface is open".
#
# An empty state makes **a statement about the world**, and it always points at an action (`+ NEW
# ROLE`). Say it on failure and the owner acts on a config they never actually read.
#
# **Someone in the product already did this right** (`CodeCorpusConfig`'s `CorpusLoadFailed`,
# `CapabilitiesPanel` branching on `status === 'error'`) — the right way is to **hand-write the third
# state**. Hand-writing means the next section will still miss it: a check that needs remembering is a
# responsibility class (see [[structure-means-no-responsibility-class]]). So this locks "did it bypass
# ListPane", not "did you remember to add the error branch".
#
# **The shape of the judgment, both conditions required**:
#   (a) `length === 0` followed by a `? <capitalized-component` — using the count to decide which
#       component to render;
#   (b) **the same file has a load status** (`ResourceStatus` / `.status ===` / `hook.status`).
#
# Why (b): the first version checked only (a) and turned up three **false positives** — `MembersBlock`
# uses a different discriminated union (`state.kind`, error already handled separately), `PinManager`'s
# pins are a form value the owner is editing, `NeedsList`'s items are derived from stats already in
# hand. All three empty states are **real conclusions**, not failed fetches. Exempting them one by one
# is the wrong path — exemptions rot, and a rule that blocks a legitimate form pushes code somewhere
# worse (see [[gate-scope-forces-architecture]]). (b) is the rule's real boundary:
# **if you have a load status in hand, there's no reason to decide the empty state yourself.**
#
# `? null` is also let through: rendering nothing isn't a statement about the world, it's optional
# decoration (no heading when a section has no content).
#
# Self-test: a planted "has status and hand-writes the empty state" must go red; a planted "no status"
# and a `? null` must both be let through — a gate that only judges red and never green hasn't verified
# its boundary.

set -eu

OWNER="app/src/components/admin/ListPane.tsx"
SCOPE="app/src/components/admin/sections"

fail=0

# shape_hits —— condition (a): find the "pick a component by count" form. Skip comment lines: these
# files' top comments describe this history, and flagging them would force deleting the explanation.
# Let `? null` / `? <empty fragment` through. For a multi-line ternary, look at the next line.
shape_hits() {
  awk '
    /^[[:space:]]*(\/\/|\*|\/\*|\{\/\*|#)/ { next }
    /length === 0/ {
      line = $0
      if (line ~ /length === 0[[:space:]]*(\?|&&)[[:space:]]*</) {
        if (line !~ /(\?|&&)[[:space:]]*<>/) { print FILENAME ":" FNR ":" line }
        next
      }
      # Follow to the next line for all three line-break forms: `? (` / `&& (` / break at end of line.
      if (line ~ /length === 0[[:space:]]*(\?|&&)[[:space:]]*\($/ || line ~ /length === 0$/) {
        pending = FILENAME ":" FNR ":" line; next
      }
      next
    }
    pending != "" {
      # A JSX open at the start of the next line counts — **a lowercase tag counts too**: an empty
      # state is often a `<div className="sm-empty">` rather than a component, and the first version
      # recognized only `<[A-Z]`, so the SandboxPanel form walked straight past ([[gate-can-go-blind]]).
      if ($0 ~ /^[[:space:]]*(\?[[:space:]]*)?<[A-Za-z]/) { print pending }
      pending = ""
    }
  ' "$@"
}

# has_status —— condition (b): does this file have a load status in hand? A separate pass, not folded
# into awk — awk is a single-pass scan, and the status declaration may appear **after** the offending line.
has_status() {
  grep -qE 'ResourceStatus|\.status ===|hook\.status|status=\{' "$1"
}

# ⚠️ (b) was tried one level upstream (following `from '@/lib/admin/use-*'` to judge whether that hook
# has a status), and **it must not be done that way**: a file-level judgment pins one hook's status
# onto **all** list headers in the file, so `NeedsList` (derived from stats in hand) and `MembersBlock`
# (its own discriminated union, error long since handled separately) both false-positive — exactly the
# three spots the first version tripped on.
# "Does this particular list have its own status" is a dataflow question, and grep can't answer it.
# The real way to bring `InferenceUsagePanel` / `SandboxPanel` back into the gate's view is to **change
# them to ListPane**: then the file has `status=`, (b) holds naturally, and any later regression is blocked.

# scan_empties —— (a) and (b). This is the rule's boundary: if you have a load status in hand, there's no reason to decide the empty state yourself.
scan_empties() {
  for f in "$@"; do
    has_status "$f" || continue
    shape_hits "$f"
  done
}

files=$(find "$SCOPE" -name '*.tsx' -type f 2>/dev/null || true)

# 1) The scanner must actually see files — an empty list makes the check below always green (see [[assertion-that-cannot-fail]]).
n=$(printf '%s\n' "$files" | grep -c . || true)
if [ "$n" -lt 15 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — only $n tsx files under $SCOPE, the scan is blind"
  exit 2
fi

# shellcheck disable=SC2086  # $files is a newline-separated path list; word splitting is intended here
offenders=$(scan_empties $files || true)

if [ -n "$offenders" ]; then
  echo "check-one-empty-state: picking a component straight from the count —— after a failure the list is also empty, and the owner will take this empty statement at face value:"
  echo "$offenders"
  echo "                       use <ListPane status=… count=… empty={…}> ($OWNER)."
  fail=1
fi

# 2) The component must still exist, and that ordering inside it must still be there — otherwise the check above is always green.
if [ ! -f "$OWNER" ]; then
  echo "check-one-empty-state: $OWNER is gone; the rule has no owner"
  fail=1
elif ! grep -q "status === 'error'" "$OWNER"; then
  echo "check-one-empty-state: $OWNER no longer branches on the error status — the whole point is that order"
  fail=1
fi

# 3) Self-test: verify all three — judge red, and judge these two kinds of green. A gate that only
#    verifies red hasn't verified its own boundary, and this gate's first version turned up three false
#    positives for exactly that reason.
guilty=$(mktemp -t emptycheck.XXXXXX)
cat > "$guilty" <<'PLANTED'
import type { ResourceStatus } from '@/lib/state/status';
export function Bad({ rows }) {
  return rows.length === 0
    ? <EmptyRows />
    : <RowList rows={rows} />;
}
export function AlsoBad({ tags }) {
  return tags.length === 0 ? <EmptyTags /> : <TagList tags={tags} />;
}
export function Fine({ tags }) {
  return tags.length === 0 ? null : <TagList tags={tags} />;
}
// The two below are forms the first version of the gate was **blind to**, each with a real occurrence
// in the product: `&&` (InferenceUsagePanel), and paren + lowercase tag (SandboxPanel / APIKeysPanel).
export function BadAnd({ rows }) {
  return <div>{rows.length === 0 && (
    <div className="sm-empty">nothing here</div>
  )}</div>;
}
export function BadParen({ rows }) {
  return rows.length === 0 ? (
    <div className="sm-empty">nothing here</div>
  ) : (
    <RowList rows={rows} />
  );
}
PLANTED
# The no-load-status kind: same shape, but this list is derived from data in hand (PinManager / NeedsList).
derived=$(mktemp -t emptycheck.XXXXXX)
cat > "$derived" <<'PLANTED'
export function Derived({ items }) {
  return items.length === 0 ? <EmptyAction /> : <NeedRows items={items} />;
}
PLANTED
guilty_hits=$(scan_empties "$guilty" | grep -c . || true)
derived_hits=$(scan_empties "$derived" | grep -c . || true)
rm -f "$guilty" "$derived"
if [ "$guilty_hits" -ne 4 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — expected 4 planted offenders (ternary / multi-line ternary / && / paren+lowercase tag; the '? null' one let through), saw $guilty_hits"
  exit 2
fi
if [ "$derived_hits" -ne 0 ]; then
  echo "check-one-empty-state: SELF-TEST FAILED — a list with no load status in scope must be let through, saw $derived_hits"
  exit 2
fi

[ "$fail" -eq 0 ] || exit 1
echo "check-one-empty-state: an empty state only comes from ListPane ($n section files scanned; self-test passed)."
