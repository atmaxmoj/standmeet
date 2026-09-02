// WritingCrumb —— one segment of the /writings/[slug] breadcrumb.
//
// Pulled out into its own file for exactly one reason: it has to be a
// **client** component to read the reader's currently chosen language
// (`useCorpusHref`). The breadcrumb is the path back up, and that's the same
// reading session as the path down the tree — if going down carries the
// chosen language but coming back drops to English, that choice is only
// half honored.
// The page itself is a server component, and `use client` can only be
// stamped on a whole file, so this one segment was moved out.

'use client';

import Link from 'next/link';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import type { TreeNode } from '@/lib/corpus/tree';

export function WritingCrumb({ node }: { node: TreeNode }) {
  const href = useCorpusHref();
  return (
    <>
      <span className="text-(--color-faint)">{'▸'}</span>
      <Link
        href={href({ genre: 'writing', slug: node.path })}
        className="text-(--color-muted) hover:text-(--color-ink)"
      >
        {node.title}
      </Link>
    </>
  );
}
