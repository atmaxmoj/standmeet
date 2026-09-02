// /wiki — the wiki's index entry (reader style). Left 240px wiki tree sidebar
// (sticky, scrolls on its own) + main column lists the root entries. A document
// page's "<- wiki" comes back here (each doc kind returns to its own kind,
// no longer unified back to writing).
//
// Data: GET /api/v1/wiki-tree (no parent = roots), public (no token) returns
// published only.

import { getTranslations } from 'next-intl/server';

import { WikiIndexRoots } from '@/components/visitor/WikiIndexRoots';
import { fetchWikiTree, fetchWikiTreeStats } from '@/lib/api/public';

export const dynamic = 'force-dynamic';

export default async function WikiIndexPage() {
  // instance / top bar are fetched by layout — this page only needs its own data.
  const [roots, stats, t] = await Promise.all([
    fetchWikiTree('', ''), fetchWikiTreeStats(), getTranslations('reader'),
  ]);
  // Top bar / session strip / tree all live in `wiki/layout.tsx` — they don't
  // remount across articles and don't scroll with the body. This page only
  // renders its own content.
  return (
    <div className="pt-10 pb-24">
      <div className="smallcaps mb-2">{t('wiki.indexKicker')}</div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(32px,4vw,48px)] font-[380] tracking-[-0.02em] leading-[1.05] mb-8 text-pretty">
        {t('wiki.indexHeading')}
      </h1>
      {/* The SSR copy is the anonymous view (SEO needs it); the invited-visitor
          copy is refetched client-side with a token (F-L-14). */}
      <WikiIndexRoots roots={roots} stats={stats} />
    </div>
  );
}
