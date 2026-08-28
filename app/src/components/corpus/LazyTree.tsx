// LazyTree —— 通用懒加载树。数据源中性(TreeLoader),label 渲染交给调用方
// (renderLabel),所以 wiki sidebar / reader / output 树都能复用同一个组件。
//
// 行为(owner 拍板):**默认全合上**,点 ▸ 才展开;**展开某节点才取它 children**
// (懒加载,大 corpus 不一次拉整棵);ACL 由 loader 后端评估,不在 scope 的条目
// 整条不出现。缩进靠嵌套 <ul> 的 padding(CSS),不用 inline style。
//
// openPaths —— 初始就展开的 path 集(给 reader「自动展开到当前条」用):只有这条
// 祖先链被预取,不破坏懒加载。
//
// 组件层禁 if:分支全走三元 + 抽小组件;取数副作用在 effect 里用三元收口。

'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';

import type { TreeLoader, TreeNode } from '@/lib/corpus/tree';
import { useTreeLayer } from '@/lib/corpus/use-lazy-tree';
import { useTreeOpenStore } from '@/lib/visitor/tree-open-store';

import styles from '@/components/corpus/LazyTree.module.css';

interface LazyTreeProps {
  load: TreeLoader;
  renderLabel: (node: TreeNode) => React.ReactNode;
  openPaths?: ReadonlySet<string>;
}

export function LazyTree({ load, renderLabel, openPaths }: LazyTreeProps) {
  const t = useTranslations('reader');
  const roots = useTreeLayer(load, '', true);
  // 「自动展开到当前这一条」喂给 store,而不是当每个 NodeItem 的初值 ——
  // 后者会在每次导航重挂时把读者手动展开的支全部盖掉。`ensureOpen` 只加不减,
  // 所以它不会掰开读者刚收起来的那一支。
  const ensureOpen = useTreeOpenStore((st) => st.ensureOpen);
  useEffect(() => { ensureOpen([...(openPaths ?? [])]); }, [ensureOpen, openPaths]);
  return roots === null
    ? <div className={styles['loading']} data-testid="tree-loading">{t('tree.loading')}</div>
    : <NodeList nodes={roots} load={load} renderLabel={renderLabel} openPaths={openPaths} />;
}

interface NodeListProps {
  nodes: TreeNode[];
  load: TreeLoader;
  renderLabel: (node: TreeNode) => React.ReactNode;
  openPaths?: ReadonlySet<string>;
}

function NodeList({ nodes, load, renderLabel, openPaths }: NodeListProps) {
  return (
    <ul className={styles['list']}>
      {nodes.map((n) => (
        <NodeItem key={n.id} node={n} load={load} renderLabel={renderLabel} openPaths={openPaths} />
      ))}
    </ul>
  );
}

// 展开状态从 store 读，**不是** `useState`。
//
// 上一版是 `useState(() => openPaths?.has(node.path))`：换一篇文章是一次导航，整棵树连同
// 每个 NodeItem 一起重挂，初值重新读一遍 openPaths（"只展开到当前这条"），读者手动展开的
// 那几支全部塌回去、每层再拉一次。屏幕上就是「切文章的时候树重新加载了」。
// 展开是**这一趟浏览的状态**，得活得比任何一次挂载久（[[names-that-lie]] 的邻居：
// 一个看起来是组件状态的东西，其实不属于组件）。
function NodeItem({ node, load, renderLabel, openPaths }: { node: TreeNode } & Omit<NodeListProps, 'nodes'>) {
  const open = useTreeOpenStore((s) => s.open.has(node.path));
  const toggle = useTreeOpenStore((s) => s.toggle);
  const onToggle = useCallback(() => { toggle(node.path); }, [toggle, node.path]);
  // 懒加载:open=true 才取这一层(useTreeLayer 内部 enabled 守门 + 缓存)。
  const children = useTreeLayer(load, node.id, open);
  return (
    <li className={styles['item']} data-testid={`tree-node-${node.path}`}>
      <div className={styles['row']}>
        <Toggle node={node} open={open} onToggle={onToggle} />
        {renderLabel(node)}
      </div>
      <Subtree open={open} nodes={children} load={load} renderLabel={renderLabel} openPaths={openPaths} />
    </li>
  );
}

function Toggle({ node, open, onToggle }: {
  node: TreeNode; open: boolean; onToggle: () => void;
}) {
  return node.has_children ? (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={styles['toggle']}
      data-testid={`tree-toggle-${node.path}`}
    >
      {open ? '▾' : '▸'}
    </button>
  ) : <span className={styles['leaf']} aria-hidden="true" />;
}

function Subtree({ open, nodes, load, renderLabel, openPaths }: {
  open: boolean; nodes: TreeNode[] | null;
} & Omit<NodeListProps, 'nodes'>) {
  return open && nodes !== null
    ? <NodeList nodes={nodes} load={load} renderLabel={renderLabel} openPaths={openPaths} />
    : null;
}
