// WikiIndexEmpty —— when the /wiki index list is empty, the body column
// explains why on its own.
//
// This sentence used to live in the sidebar (`WikiTreeView`'s TreeStats
// footnote, F-L-11 part B). But the sidebar is hidden entirely below `lg` —
// which is **correct** responsive behavior, since a desktop-scale tree
// can't fit into 390px. The cost was: on mobile, a visitor got a plain
// white page with nothing below the heading "The corpus, by entry" — no
// reason, no next step. F-L-11 fixed exactly "a pile of numbers paired
// with an empty tree amounts to bragging with nothing behind it", and it
// came right back on another viewport.
//
// So this sentence moved into the body column — it answers "why is the
// list in front of me empty", and that list is right here. The sidebar
// keeps its count (a number is extra information for wide screens, not
// the answer to this question).
//
// The two kinds of "empty" are two different things and must not share a
// sentence:
//   - there are entries, but they're all private to an anonymous visitor
//     → this is an **invitation**: go enter a code.
//   - there's really nothing at all → this is **hasn't started yet**: say
//     so honestly, don't imply something is hiding.
// Using one sentence to stand in for the other is promising a rest that
// isn't there.

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { WikiTreeStats } from '@/lib/api/public';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

// allGatedAnonymous —— no session, and published (= entries − gated) is 0.
// Doesn't apply to an invited visitor: every entry opens for them, so
// telling them "these are private" would be a false statement (F-L-14).
export function allGatedAnonymous(hasSession: boolean, stats: WikiTreeStats): boolean {
  return !hasSession && stats.entries > 0 && stats.entries === stats.gated;
}

export function WikiIndexEmpty({ stats, empty }: { stats: WikiTreeStats; empty: boolean }) {
  const session = useVisitorSessionStore((s) => s.session);
  return empty ? <EmptyReason gated={allGatedAnonymous(session !== null, stats)} /> : null;
}

function EmptyReason({ gated }: { gated: boolean }) {
  return gated ? <GatedHint /> : <NothingYet />;
}

// GatedHint —— there's content, but it's private to this visitor. This is
// an **invitation**, so it carries a destination.
function GatedHint() {
  const t = useTranslations('visitor.wikiTreeView');
  return (
    <div data-testid="wiki-tree-gated-hint" className="mono text-[12px] text-(--color-muted)">
      <Link href="/gate" className="hover:text-(--color-accent) transition-colors">
        {t('gatedHint')} {'→'}
      </Link>
    </div>
  );
}

// NothingYet —— there's truly nothing at all. No destination given, since
// entering a code won't conjure anything up.
function NothingYet() {
  const t = useTranslations('visitor.wikiTreeView');
  return (
    <div data-testid="wiki-index-empty" className="mono text-[12px] text-(--color-faint)">
      {t('indexEmpty')}
    </div>
  );
}
