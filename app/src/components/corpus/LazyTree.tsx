// LazyTree — generic lazy-loading tree. Data source is neutral (TreeLoader); label
// rendering is delegated to the caller (renderLabel), so the wiki sidebar / reader /
// output trees can all reuse this one component.
//
// Behavior (owner decision): **collapsed by default**, expand only on clicking ▸;
// **expanding a node fetches its children** (lazy load — a large corpus isn't pulled
// whole at once); ACL is evaluated by the loader's backend, entries out of scope don't
// appear at all. Indentation relies on nested <ul> padding (CSS), not inline style.
//
// openPaths — the set of paths open on initial mount (for reader's "auto-expand to
// the current entry"): only that ancestor chain is prefetched, so lazy loading stays
// intact.
//
// No `if` at the component layer: every branch goes through a ternary + an extracted
// small component; fetch side effects are wrapped in a ternary inside the effect.

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
  // Feed "auto-expand to the current entry" into the store, rather than using it as
  // each NodeItem's initial value — the latter would wipe out every branch the reader
  // manually expanded on each remount from navigation. `ensureOpen` only adds, never
  // removes, so it never re-opens a branch the reader just collapsed.
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

// Expanded state reads from the store, **not** `useState`.
//
// The previous version used `useState(() => openPaths?.has(node.path))`: switching
// articles is a navigation, so the whole tree — and every NodeItem — remounts and
// re-reads openPaths from its initial value ("expand only to the current entry").
// Every branch the reader had manually expanded collapsed back down, and each level
// refetched. On screen this looked like "the tree reloads every time you switch
// articles." Expansion is state for **this browsing session** and must outlive any
// single mount (a cousin of [[names-that-lie]]: something that looks like component
// state actually isn't).
function NodeItem({ node, load, renderLabel, openPaths }: { node: TreeNode } & Omit<NodeListProps, 'nodes'>) {
  const open = useTreeOpenStore((s) => s.open.has(node.path));
  const toggle = useTreeOpenStore((s) => s.toggle);
  const onToggle = useCallback(() => { toggle(node.path); }, [toggle, node.path]);
  // Lazy load: this level is only fetched once open=true (useTreeLayer gates on
  // `enabled` internally and caches the result).
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
