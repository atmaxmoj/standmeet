// ListPane —— the three outcomes of "one list" in admin: still loading / failed to load /
// loaded (possibly empty).
//
// **Why this must be a component, not a discipline** (F-N-7).
//
// Every section used to write its own `hook.list.length === 0 ? <empty/> : <list/>`. That line
// misses a third outcome: after a load fails, the list is also an empty array, so **failure
// wears the empty state's clothes**. Driven for real in prod, this looked like `/admin/roles`
// printing "No roles yet — public is normally seeded on owner claim." while that instance had
// three roles; `/admin/ip-bans` was worse still — "No IPs banned. The public surface is open."
//
// An empty state states **a fact about the world**, and it always points at an action (`+ NEW
// ROLE`). Saying it during a failure leads the owner to act on a configuration they never
// actually read.
//
// The product **already has examples done right** (`CodeCorpusConfig`'s `CorpusLoadFailed`,
// `CapabilitiesPanel` checking `status === 'error'`) — done right by **hand-writing the third
// state**. And hand-writing it means the next section will miss it again: a check that depends
// on someone remembering is a responsibility class
// ([[structure-means-no-responsibility-class]]). So the ordering is **welded into one place**
// here: error is checked before `count === 0`, making it structurally impossible for the empty
// state to grow out of a failure ([[reframes-tasks-into-enforced-invariants]]).
//
// Paired gate: `check-one-empty-state.sh` — no hand-written
// "`length === 0` -> empty state" may appear in an admin section again.

'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import type { ResourceStatus } from '@/lib/state/status';

// isPending —— hasn't loaded yet. `idle` counts too: ensureLoaded hasn't fired, and the screen
// shouldn't draw any conclusion yet.
function isPending(status: ResourceStatus): boolean {
  return status === 'idle' || status === 'loading';
}

export function ListPane({ status, count, empty, skeleton, children }: {
  status: ResourceStatus;
  // count —— the number of items loaded. **Not** the length of children: the empty state is
  // decided by the data, not by what got rendered.
  count: number;
  empty: ReactNode;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  return isPending(status)
    ? (skeleton ?? <CardGridSkeleton />)
    : <LoadedPane status={status} count={count} empty={empty}>{children}</LoadedPane>;
}

// LoadedPane —— the two outcomes once loading finishes. **The order of these three lines is
// the reason this component exists** — don't reorder them.
function LoadedPane({ status, count, empty, children }: {
  status: ResourceStatus;
  count: number;
  empty: ReactNode;
  children: ReactNode;
}) {
  return status === 'error'
    ? <SectionLoadFailed />
    : count === 0 ? empty : children;
}

// SectionLoadFailed —— one sentence, one place. The wording must **name the misreading
// directly**: when a piece is missing in front of the owner, the default reading is "so there
// is none" — this sentence has to say plainly "this isn't 'none', it's 'unknown'".
// No HTTP verbs / status codes / internal paths allowed (pinned by the
// `admin-load-failure-not-empty` guard).
function SectionLoadFailed() {
  const t = useTranslations('adminShell.listPane');
  return (
    <p
      data-testid="section-load-failed"
      className="reading italic text-(--color-accent)"
    >
      {t('loadFailed')}
    </p>
  );
}
