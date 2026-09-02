// WikiIndexRoots —— the root-entry list in the /wiki index body.
//
// Why it has to be a client component: the visitor's session token only
// exists in the browser, invisible to SSR. The page fetches root entries
// server-side under an anonymous identity, getting back only the published
// ones — so an invited visitor whose role grants `wiki://**` can see all
// four roots in the sidebar tree, open every entry page, and even get chat
// answers citing 11 notes, while the **index** shows just one, with a
// footnote reading "222 GATED". Four surfaces giving two different answers
// to the same question (F-L-14).
//
// The fix follows the same pattern as F-L-11 (reader body) and F-L-13
// (sub-entry rail): SSR provides the anonymous version as a fallback (SEO
// needs it), then a second fetch with the token after mount, swapping in
// whatever more it finds.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { WikiIndexEmpty } from '@/components/visitor/WikiIndexEmpty';
import { subscribeScopedRoots } from '@/lib/visitor/load-wiki-children';

export function WikiIndexRoots({ roots, stats }: {
  roots: readonly TreeNode[];
  stats: WikiTreeStats;
}) {
  const [scoped, setScoped] = useState<readonly TreeNode[] | null>(null);
  useEffect(() => subscribeScopedRoots(setScoped), []);
  const shown = scoped ?? roots;
  const href = useCorpusHref();
  return (
    <>
      <ul className="flex flex-col gap-3 list-none p-0 m-0" data-testid="wiki-index-roots">
        {shown.map((n) => (
          <li key={n.id}>
            <Link
              href={href({ genre: 'wiki', path: n.path })}
              className="font-serif text-(--color-ink) hover:text-(--color-accent) text-[19px]"
            >
              {n.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* An empty list explains why on its own — that sentence used to
          live only in the sidebar, which doesn't exist on narrow screens. */}
      <WikiIndexEmpty stats={stats} empty={shown.length === 0} />
    </>
  );
}
