// WikiTreeView —— the wiki tree on the reader's left side. **Lazy
// loading**: goes through LazyTree (loadWikiChildren), fetching level by
// level on demand (ACL is filtered by the backend per the token's scope —
// anything out of scope doesn't appear at all), never prefetching the
// whole tree. "Auto-expand to the current entry" works by stuffing each
// prefix level of activePath into openPaths — only this one ancestor chain
// gets prefetched, so lazy loading stays intact. The current entry is
// highlighted with the accent color.
//
// Components ban if: all ternaries + extracted small components.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import { LazyTree } from '@/components/corpus/LazyTree';
import type { TreeNode } from '@/lib/corpus/tree';
import type { WikiTreeStats } from '@/lib/api/public';
import { loadWikiChildren, subscribeScopedStats } from '@/lib/visitor/load-wiki-children';

import styles from '@/components/visitor/WikiTreeView.module.css';

// activePath is derived from the **URL** — no longer passed by the caller.
//
// Passing it as a prop would force the outer layout to change with
// "which article is current" — and a layout change means a rerender,
// putting the tree right back to "refresh on every article click".
// Highlighting is already a function of the URL, so let it read the URL
// directly, and the layout can be completely unconcerned with which
// article is current (the inverse of [[names-that-lie]]: let data come
// from its actual source).
export function WikiTreeView({ stats }: { stats: WikiTreeStats }) {
  const activePath = decodeURIComponent(usePathname() ?? '').replace(/^\/wiki\/?/, '');
  const t = useTranslations('visitor.wikiTreeView');
  const openPaths = prefixSet(activePath);
  const renderLabel = useCallback(
    (node: TreeNode) => <WikiLabel node={node} active={node.path === activePath} />,
    [activePath],
  );
  return (
    <nav className={styles['aside']} data-testid="wiki-tree" aria-label="wiki tree">
      <div className={styles['head']}>
        <span className={styles['headLabel']}>{t('head')}</span>
      </div>
      <LazyTree load={loadWikiChildren} renderLabel={renderLabel} openPaths={openPaths} />
      <TreeStats stats={stats} />
    </nav>
  );
}

// TreeStats —— the count anchored at the foot of the sidebar (a pure COUNT
// aggregate, doesn't pull the tree, doesn't break lazy loading).
//
// The sentence "these are private — enter a code" (F-L-11 part B) used to
// hang here. It moved to `WikiIndexEmpty`, rendered by the **body
// column** — because this whole sidebar column is hidden below `lg`
// (correctly so: a desktop-scale tree can't fit into 390px), so that
// sentence simply didn't exist on mobile, leaving a visitor with a plain
// white page and no reason and no next step. F-L-11 fixed exactly "a pile
// of numbers paired with an empty tree amounts to bragging with nothing
// behind it", and it came right back on another viewport. One fact, one
// home: that sentence answers "why is the list in front of me empty",
// and the list lives in the body, not here.
function TreeStats({ stats }: { stats: WikiTreeStats }) {
  const t = useTranslations('visitor.wikiTreeView');
  // SSR can't see the visitor's token, so the SSR copy's GATED count
  // describes the anonymous visitor. When there's a session, refetch once
  // under that visitor's grant — otherwise an invited visitor reads "222
  // GATED" while every one of their entries actually opens (F-L-14).
  const [scoped, setScoped] = useState<WikiTreeStats | null>(null);
  useEffect(() => subscribeScopedStats(setScoped), []);
  const shown = scoped ?? stats;
  return (
    <div className={styles['stats']} data-testid="wiki-tree-stats">
      {/* The count is passed through String(): ICU would add thousands
          separators to a number (1,234), while raw JSX outputs 1234. */}
      {t.rich('stats', {
        entries: String(shown.entries), roots: String(shown.roots), gated: String(shown.gated),
        num: (c) => <span className={styles['statNum']}>{c}</span>,
      })}
    </div>
  );
}

function WikiLabel({ node, active }: { node: TreeNode; active: boolean }) {
  // useCorpusHref rather than corpusHref: the language the reader picked
  // needs to carry through the link, or opening the next entry falls back
  // to English.
  const href = useCorpusHref();
  return (
    <Link
      href={href({ genre: 'wiki', path: node.path })}
      className={`${styles['link']} ${node.locked ? styles['locked'] : ''}`}
      data-active={active ? 'true' : undefined}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}

// prefixSet —— "a/b/c" → {"a","a/b","a/b/c"}: every level from the root to
// the current entry, for openPaths to auto-expand to the current one
// (prefetching only this one chain).
function prefixSet(path: string): ReadonlySet<string> {
  const segs = path.split('/').filter(Boolean);
  const out = new Set<string>();
  let cur = '';
  for (const s of segs) {
    cur = cur === '' ? s : `${cur}/${s}`;
    out.add(cur);
  }
  return out;
}
