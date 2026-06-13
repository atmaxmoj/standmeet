// WikiTreeView —— reader 左侧 wiki 树,像素级对齐设计 wiki.js TreeAside:
// 「wiki tree / toggle all」抬头 → 递归节点(folder 用 ▸/▾、leaf 用 ·,缩进 +
// 虚线导引,当前条 accent 底+字,folder 加粗,gated 斜体 + ● 红点)→ 统计脚注
// (N entries · N roots / N gated)。整棵 SSR 传入,默认展开到当前条。
//
// 组件层禁 if:分支全三元 + 抽小组件;折叠态纯逻辑在 lib/wiki-tree-collapse。

'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';

import type { WikiTreeFull, WikiTreeFullNode } from '@/lib/api/public';
import { allToggled, initialCollapsed, toggledSet } from '@/lib/visitor/wiki-tree-collapse';

import styles from '@/components/visitor/WikiTreeView.module.css';

type RowCtx = {
  activePath: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
};

export function WikiTreeView({ tree, activePath }: { tree: WikiTreeFull; activePath: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => initialCollapsed(tree.nodes, activePath),
  );
  const onToggle = useCallback((id: string) => {
    setCollapsed((prev) => toggledSet(prev, id));
  }, []);
  const onToggleAll = useCallback(() => {
    setCollapsed((prev) => allToggled(prev, tree.nodes));
  }, [tree.nodes]);
  const ctx: RowCtx = { activePath, collapsed, onToggle };
  return (
    <nav className={styles['aside']} data-testid="wiki-tree" aria-label="wiki tree">
      <div className={styles['head']}>
        <span className={styles['headLabel']}>wiki tree</span>
        <button
          type="button" onClick={onToggleAll}
          className={styles['toggleAll']} data-testid="wiki-tree-toggle-all"
        >
          toggle all
        </button>
      </div>
      <ul className={styles['list']}>
        {tree.nodes.map((n) => <TreeRow key={n.id} node={n} ctx={ctx} />)}
      </ul>
      <Stats total={tree.total} roots={tree.roots} gated={tree.gated} />
    </nav>
  );
}

function TreeRow({ node, ctx }: { node: WikiTreeFullNode; ctx: RowCtx }) {
  const isFolder = node.children.length > 0;
  const isCurrent = node.path === ctx.activePath;
  return (
    <li className={styles['item']}>
      <div className={rowCls(isCurrent)} data-testid={`wiki-tree-row-${node.path}`}>
        <Caret
          isFolder={isFolder} isCurrent={isCurrent}
          isCollapsed={ctx.collapsed.has(node.id)}
          onToggle={() => ctx.onToggle(node.id)}
        />
        <TreeLink node={node} isFolder={isFolder} isCurrent={isCurrent} />
        <LockedDot locked={node.locked === true} />
      </div>
      <Subtree node={node} isFolder={isFolder} collapsed={ctx.collapsed.has(node.id)} ctx={ctx} />
    </li>
  );
}

const rowCls = (current: boolean): string =>
  `${styles['row']} ${current ? styles['current'] : ''}`;

function TreeLink({ node, isFolder, isCurrent }: {
  node: WikiTreeFullNode; isFolder: boolean; isCurrent: boolean;
}) {
  return (
    <Link
      href={`/wiki/${node.path}`}
      className={linkCls(isFolder, node.locked === true)}
      data-active={isCurrent ? 'true' : undefined}
      title={node.title}
    >
      {node.title}
    </Link>
  );
}

const linkCls = (isFolder: boolean, locked: boolean): string => [
  styles['link'],
  isFolder ? styles['folder'] : '',
  locked ? styles['locked'] : '',
].join(' ');

const caretCls = (isCurrent: boolean): string =>
  `${styles['caret']} ${isCurrent ? styles['caretCurrent'] : ''}`;

function LockedDot({ locked }: { locked: boolean }) {
  return locked ? <span className={styles['dot']} aria-label="gated">●</span> : null;
}

function Caret({ isFolder, isCollapsed, isCurrent, onToggle }: {
  isFolder: boolean; isCollapsed: boolean; isCurrent: boolean; onToggle: () => void;
}) {
  return isFolder
    ? <CaretBtn isCollapsed={isCollapsed} isCurrent={isCurrent} onToggle={onToggle} />
    : <span className={styles['leaf']} aria-hidden="true">·</span>;
}

function CaretBtn({ isCollapsed, isCurrent, onToggle }: {
  isCollapsed: boolean; isCurrent: boolean; onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); onToggle(); }}
      className={caretCls(isCurrent)}
      aria-label={isCollapsed ? 'expand' : 'collapse'}
    >
      {isCollapsed ? '▸' : '▾'}
    </button>
  );
}

function Subtree({ node, isFolder, collapsed, ctx }: {
  node: WikiTreeFullNode; isFolder: boolean; collapsed: boolean; ctx: RowCtx;
}) {
  return isFolder && !collapsed ? (
    <ul className={styles['children']}>
      {node.children.map((c) => <TreeRow key={c.id} node={c} ctx={ctx} />)}
    </ul>
  ) : null;
}

function Stats({ total, roots, gated }: { total: number; roots: number; gated: number }) {
  return (
    <div className={styles['stats']} data-testid="wiki-tree-stats">
      <div>
        <span className={styles['statNum']}>{total}</span> entries
        {' · '}
        <span className={styles['statNum']}>{roots}</span> roots
      </div>
      <div><span className={styles['statNum']}>{gated}</span> gated</div>
    </div>
  );
}
