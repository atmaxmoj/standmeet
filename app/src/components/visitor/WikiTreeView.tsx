// WikiTreeView —— reader 左侧 wiki 树。**懒加载**:走 LazyTree(loadWikiChildren),
// 一层层按需取(ACL 由后端按 token scope 过滤,不在 scope 整条不出现),不预取整树。
// 「自动展开到当前条」靠把 activePath 的各级前缀塞进 openPaths —— 只这条祖先链被
// 预取,不破坏懒加载。当前条 accent 高亮。
//
// 组件层禁 if:全三元 + 抽小组件。

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

// activePath 从 **URL** 派生，不再由调用方传。
//
// 传 prop 的话，外层那个 layout 就得跟着「当前是哪一篇」变 —— 而 layout 一变就重渲，
// 树又回到「每点一篇文章刷一次」。高亮本来就是 URL 的函数，让它直接读 URL，
// layout 因此可以完全不关心当前在哪一篇（[[names-that-lie]] 的反面：让数据来自它真正的源）。
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

// TreeStats —— 侧栏脚定位计数(纯 COUNT 聚合,不拉树、不破坏懒加载)。
//
// 那句「这些是私有的 —— 输码」(F-L-11 part B)以前挂在这里。它搬到 `WikiIndexEmpty`,
// 由**正文列**渲染 —— 因为这一整列侧栏在 `lg` 以下是隐藏的(那是对的:桌面版这棵树塞不进
// 390px),于是手机上那句话不存在,访客拿到一张纯白页,没有原因也没有下一步。
// F-L-11 修的就是「一堆数字配一棵空树等于吹牛」,而它在另一个视口上原样回来了。
// 一句事实一个家:那句话回答的是「我眼前这张列表为什么空」,而列表在正文里,不在这儿。
function TreeStats({ stats }: { stats: WikiTreeStats }) {
  const t = useTranslations('visitor.wikiTreeView');
  // SSR 拿不到访客 token,所以 SSR 那份 GATED 数说的是匿名访客的事。有 session 就按这位
  // 访客的 grant 重取一次 —— 否则受邀访客读到「222 GATED」,而他每一条都打得开(F-L-14)。
  const [scoped, setScoped] = useState<WikiTreeStats | null>(null);
  useEffect(() => subscribeScopedStats(setScoped), []);
  const shown = scoped ?? stats;
  return (
    <div className={styles['stats']} data-testid="wiki-tree-stats">
      {/* 计数用 String() 传:ICU 会给 number 加千分位(1,234),原 JSX 直出 1234。 */}
      {t.rich('stats', {
        entries: String(shown.entries), roots: String(shown.roots), gated: String(shown.gated),
        num: (c) => <span className={styles['statNum']}>{c}</span>,
      })}
    </div>
  );
}

function WikiLabel({ node, active }: { node: TreeNode; active: boolean }) {
  // useCorpusHref 而不是 corpusHref:读者选的语言要跟着链接走,否则点开下一条就回英文。
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
