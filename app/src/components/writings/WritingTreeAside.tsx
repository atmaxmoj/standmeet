// WritingTreeAside —— the reader's left-side 240px writing tree nav. Reuses
// the generic LazyTree, wired to the writing data source
// (fetchWritingTree) + writing label (Link to /writings/<slug>, current
// entry highlighted, private entries shown italic and locked). Proves
// LazyTree is genuinely reused: it's the same component as WikiTreeAside,
// only the loader/label swapped.

'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
import { LazyTree } from '@/components/corpus/LazyTree';
import type { TreeNode } from '@/lib/corpus/tree';
import { fetchWritingTree } from '@/lib/api/public';

import styles from '@/components/writings/WritingTreeAside.module.css';

export function WritingTreeAside({ activeSlug }: { activeSlug: string }) {
  const t = useTranslations('writings.tree');
  const renderLabel = useCallback(
    (node: TreeNode) => <WritingLabel node={node} active={node.path === activeSlug} />,
    [activeSlug],
  );
  return (
    <nav className={styles['aside']} data-testid="writing-tree" aria-label="writing tree">
      <div className={styles['head']}>{t('head')}</div>
      <LazyTree load={fetchWritingTree} renderLabel={renderLabel} />
    </nav>
  );
}

function WritingLabel({ node, active }: { node: TreeNode; active: boolean }) {
  const href = useCorpusHref();
  return (
    <Link
      href={href({ genre: 'writing', slug: node.path })}
      className={styles['link']}
      data-active={active ? 'true' : undefined}
      data-locked={node.locked ? 'true' : undefined}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}
