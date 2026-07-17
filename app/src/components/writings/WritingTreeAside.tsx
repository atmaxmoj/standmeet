// WritingTreeAside —— reader 左侧 240px writing 树导航。复用通用 LazyTree,接
// writing 数据口(fetchWritingTree)+ writing label(Link 到 /writings/<slug>,
// 当前条高亮,private 标 locked 斜体)。证明 LazyTree 真复用:跟 WikiTreeAside
// 同一个组件,只换 loader/label。

'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

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
  return (
    <Link
      href={`/writings/${node.path}`}
      className={styles['link']}
      data-active={active ? 'true' : undefined}
      data-locked={node.locked ? 'true' : undefined}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}
