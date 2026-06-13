// WikiTreeView —— reader 左侧 wiki 树。**懒加载**:走 LazyTree(loadWikiChildren),
// 一层层按需取(ACL 由后端按 token scope 过滤,不在 scope 整条不出现),不预取整树。
// 「自动展开到当前条」靠把 activePath 的各级前缀塞进 openPaths —— 只这条祖先链被
// 预取,不破坏懒加载。当前条 accent 高亮。
//
// 组件层禁 if:全三元 + 抽小组件。

'use client';

import { useCallback } from 'react';
import Link from 'next/link';

import { LazyTree } from '@/components/corpus/LazyTree';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadWikiChildren } from '@/lib/visitor/load-wiki-children';

import styles from '@/components/visitor/WikiTreeView.module.css';

export function WikiTreeView({ activePath }: { activePath: string }) {
  const openPaths = prefixSet(activePath);
  const renderLabel = useCallback(
    (node: TreeNode) => <WikiLabel node={node} active={node.path === activePath} />,
    [activePath],
  );
  return (
    <nav className={styles['aside']} data-testid="wiki-tree" aria-label="wiki tree">
      <div className={styles['head']}>
        <span className={styles['headLabel']}>wiki tree</span>
      </div>
      <LazyTree load={loadWikiChildren} renderLabel={renderLabel} openPaths={openPaths} />
    </nav>
  );
}

function WikiLabel({ node, active }: { node: TreeNode; active: boolean }) {
  return (
    <Link
      href={`/wiki/${node.path}`}
      className={`${styles['link']} ${node.locked ? styles['locked'] : ''}`}
      data-active={active ? 'true' : undefined}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}

// prefixSet —— "a/b/c" → {"a","a/b","a/b/c"}:从根到当前条每一级,供 openPaths
// 自动展开到当前(只预取这条链)。
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
