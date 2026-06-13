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

import { useCallback, useState } from 'react';

import type { TreeLoader, TreeNode } from '@/lib/corpus/tree';
import { useTreeLayer } from '@/lib/corpus/use-lazy-tree';

import styles from '@/components/corpus/LazyTree.module.css';

interface LazyTreeProps {
  load: TreeLoader;
  renderLabel: (node: TreeNode) => React.ReactNode;
  openPaths?: ReadonlySet<string>;
}

export function LazyTree({ load, renderLabel, openPaths }: LazyTreeProps) {
  const roots = useTreeLayer(load, '', true);
  return roots === null
    ? <div className={styles['loading']} data-testid="tree-loading">loading…</div>
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

function NodeItem({ node, load, renderLabel, openPaths }: { node: TreeNode } & Omit<NodeListProps, 'nodes'>) {
  const [open, setOpen] = useState(() => openPaths?.has(node.path) ?? false);
  const onToggle = useCallback(() => { setOpen((o) => !o); }, []);
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
