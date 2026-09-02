// WikiScopedSubEntries —— F-L-13's "sub-entries" rail on the reader entry
// page. SSR fetches context under an anonymous scope, so an invited
// visitor (with a code's role scope) can't see their own gated sub-entries
// — the rail comes back empty, and the page becomes a navigation dead end.
// This does progressive enhancement: first render what SSR gave
// (published) children, then after mount, refetch once under the
// visitor's scope using the stored session token to fill in the gated
// sub-entries. No token (anonymous) → no refetch, SSR's published list is
// final. The logic mirrors load-wiki-children's token-fetch approach (the
// reader sidebar's lazy loading does the same thing).

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import type { TreeNode } from '@/lib/corpus/tree';
import { subscribeScopedChildren } from '@/lib/visitor/load-wiki-children';

export function WikiScopedSubEntries({ slug, initial }: { slug: string; initial: TreeNode[] }) {
  const t = useTranslations('reader');
  const [nodes, setNodes] = useState<TreeNode[]>(initial);
  useEffect(() => subscribeScopedChildren(slug, setNodes), [slug]);
  const href = useCorpusHref();
  return nodes.length > 0 ? (
    <div className="mt-12" data-testid="wiki-subentries">
      <div className="smallcaps mb-3">{t('wiki.subEntries')}</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 list-none p-0 m-0">
        {nodes.map((c) => (
          <li key={c.id}>
            <Link
              href={href({ genre: 'wiki', path: c.path })}
              className="reading text-(--color-ink) hover:text-(--color-accent) text-[15px]"
            >
              {c.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
