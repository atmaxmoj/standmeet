// LazyTree —— 通用懒加载树。数据源中性(TreeLoader),label 渲染交给调用方
// (renderLabel),所以 wiki sidebar / reader / output 树都能复用同一个组件。
//
// 行为(owner 拍板):**默认全合上**,点 ▸ 才展开;**展开某节点才取它 children**
// (懒加载,大 corpus 不一次拉整棵);ACL 由 loader 后端评估,不在 scope 的条目
// 整条不出现。缩进靠嵌套 <ul> 的 padding(CSS),不用 inline style。
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
}

export function LazyTree({ load, renderLabel }: LazyTreeProps) {
  const roots = useTreeLayer(load, '', true);
  return roots === null
    ? <div className={styles['loading']} data-testid="tree-loading">loading…</div>
    : <NodeList nodes={roots} load={load} renderLabel={renderLabel} />;
}

interface NodeListProps {
  nodes: TreeNode[];
  load: TreeLoader;
  renderLabel: (node: TreeNode) => React.ReactNode;
}

function NodeList({ nodes, load, renderLabel }: NodeListProps) {
  return (
    <ul className={styles['list']}>
      {nodes.map((n) => (
        <NodeItem key={n.id} node={n} load={load} renderLabel={renderLabel} />
      ))}
    </ul>
  );
}

function NodeItem({ node, load, renderLabel }: { node: TreeNode } & Omit<NodeListProps, 'nodes'>) {
  const [open, setOpen] = useState(false);
  const onToggle = useCallback(() => { setOpen((o) => !o); }, []);
  // 懒加载:open=true 才取这一层(useTreeLayer 内部 enabled 守门 + 缓存)。
  const children = useTreeLayer(load, node.id, open);
  return (
    <li className={styles['item']} data-testid={`tree-node-${node.path}`}>
      <div className={styles['row']}>
        <Toggle node={node} open={open} onToggle={onToggle} />
        {renderLabel(node)}
      </div>
      <Subtree open={open} nodes={children} load={load} renderLabel={renderLabel} />
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

function Subtree({ open, nodes, load, renderLabel }: {
  open: boolean; nodes: TreeNode[] | null;
} & Omit<NodeListProps, 'nodes'>) {
  return open && nodes !== null
    ? <NodeList nodes={nodes} load={load} renderLabel={renderLabel} />
    : null;
}
