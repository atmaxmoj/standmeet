// WikiTreeAside —— wiki landing 左侧 240px 树导航。把通用 LazyTree 接上 wiki
// 数据口(loadWikiChildren,带 ACL)+ wiki label(Link 到 /wiki/<path>,当前条
// 高亮)。reader/writing 入口(#43)用同一个 LazyTree 换个 loader/label 即可。

'use client';

import { useCallback } from 'react';
import Link from 'next/link';

import { LazyTree } from '@/components/corpus/LazyTree';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadWikiChildren } from '@/lib/visitor/load-wiki-children';

import styles from '@/components/visitor/WikiTreeAside.module.css';

export function WikiTreeAside({ activePath }: { activePath: string }) {
  const renderLabel = useCallback(
    (node: TreeNode) => <WikiLabel node={node} active={node.path === activePath} />,
    [activePath],
  );
  return (
    <nav className={styles['aside']} data-testid="wiki-tree" aria-label="wiki tree">
      <div className={styles['head']}>wiki</div>
      <LazyTree load={loadWikiChildren} renderLabel={renderLabel} />
    </nav>
  );
}

function WikiLabel({ node, active }: { node: TreeNode; active: boolean }) {
  return (
    <Link
      href={`/wiki/${node.path}`}
      className={styles['link']}
      data-active={active ? 'true' : undefined}
    >
      {node.title}
    </Link>
  );
}
