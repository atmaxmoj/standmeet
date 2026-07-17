// CorpusLazyTree —— the admin corpus tree, lazy per level. Renders each node's rich card
// (renderCard: excerpt / tags / edit·promote·delete) inside the shared LazyTree markup;
// a node fetches its children only when expanded (▸), so a big corpus never loads whole.
// Mutations bump the corpus epoch → open levels refetch. Mirrors the public LazyTree but
// carries the full admin row (not a label-only TreeNode) and reuses its CSS module.

'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';
import { useAdminTreeLayer } from '@/lib/admin/use-admin-tree-layer';

import styles from '@/components/corpus/LazyTree.module.css';

interface TreeRow {
  id: string;
  has_children?: boolean;
}

// Common —— what every level (root + nested) needs. The root adds `testid` (LazyProps).
interface Common<T extends TreeRow> {
  load: (parentID: string) => Promise<T[]>;
  rowTestid: (row: T) => string;
  renderCard: (row: T, meta: { depth: number; hasChildren: boolean }) => ReactNode;
}

interface LazyProps<T extends TreeRow> extends Common<T> {
  testid: string;
}

export function CorpusLazyTree<T extends TreeRow>({ load, testid, rowTestid, renderCard }: LazyProps<T>) {
  const t = useTranslations('adminCorpus.common');
  const epoch = useCorpusEpoch();
  const roots = useAdminTreeLayer(load, '', true, epoch);
  return roots === null
    ? <div className={styles['loading']} data-testid={testid}>{t('loading')}</div>
    : (
      <ul className={styles['list']} data-testid={testid}>
        {roots.map((n) => (
          <TreeNode key={n.id} node={n} depth={0} epoch={epoch}
            load={load} rowTestid={rowTestid} renderCard={renderCard} />
        ))}
      </ul>
    );
}

function TreeNode<T extends TreeRow>(
  { node, depth, epoch, load, rowTestid, renderCard }:
  { node: T; depth: number; epoch: number } & Common<T>,
) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.has_children ?? false;
  const children = useAdminTreeLayer(load, node.id, open, epoch);
  return (
    <li className={styles['item']} data-testid={rowTestid(node)}>
      <div className={styles['row']}>
        <Toggle open={open} hasChildren={hasChildren} onToggle={() => setOpen((o) => !o)} rt={rowTestid(node)} />
        <div className="min-w-0 flex-1">{renderCard(node, { depth, hasChildren })}</div>
      </div>
      <Subtree open={open} nodes={children} depth={depth} epoch={epoch}
        load={load} rowTestid={rowTestid} renderCard={renderCard} />
    </li>
  );
}

function Subtree<T extends TreeRow>(
  { open, nodes, depth, epoch, load, rowTestid, renderCard }:
  { open: boolean; nodes: T[] | null; depth: number; epoch: number } & Common<T>,
) {
  return open && nodes !== null ? (
    <ul className={styles['list']}>
      {nodes.map((c) => (
        <TreeNode key={c.id} node={c} depth={depth + 1} epoch={epoch}
          load={load} rowTestid={rowTestid} renderCard={renderCard} />
      ))}
    </ul>
  ) : null;
}

function Toggle({
  open, hasChildren, onToggle, rt,
}: { open: boolean; hasChildren: boolean; onToggle: () => void; rt: string }) {
  return hasChildren ? (
    <button
      type="button" onClick={onToggle} aria-expanded={open}
      className={styles['toggle']} data-testid={`tree-toggle-${rt}`}
    >
      {open ? '▾' : '▸'}
    </button>
  ) : <span className={styles['leaf']} aria-hidden="true" />;
}
