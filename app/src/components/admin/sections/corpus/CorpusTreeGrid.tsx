// CorpusTreeGrid —— shared tree ⇄ grid body for all four corpus genres. Given a view
// mode + flat rows, renders either the depth-indented hierarchy (tree) or the flat
// 2-col card wall (grid), delegating each card to the caller's renderCard. Centralises
// the one data-driven inline-margin (the only place the tree indent lives).

'use client';

import type { ReactNode } from 'react';

import { buildCorpusForest } from '@/lib/admin/corpus-tree';
import type { CorpusView } from '@/lib/admin/corpus-view';

interface RowRef {
  id: string;
  parent_id?: string | null;
}

type CardMeta = { depth: number; hasChildren: boolean };

interface Props<T> {
  view: CorpusView;
  rows: readonly T[];
  testid: string;
  rowTestid: (row: T) => string;
  renderCard: (row: T, meta: CardMeta) => ReactNode;
}

export function CorpusTreeGrid<T extends RowRef>(props: Props<T>) {
  return props.view === 'tree' ? <Tree {...props} /> : <Grid {...props} />;
}

function Tree<T extends RowRef>({ rows, testid, rowTestid, renderCard }: Props<T>) {
  return (
    <div className="flex flex-col gap-y-2" data-testid={testid}>
      {buildCorpusForest(rows).map(({ row, depth, hasChildren }) => (
        <div
          key={row.id}
          data-testid={rowTestid(row)}
          // eslint-disable-next-line no-restricted-syntax -- tree indent is data-driven: depth is unbounded, Tailwind can't express a per-node dynamic margin
          style={{ marginLeft: `${depth * 22}px` }}
          className={depth > 0 ? 'border-l border-(--color-rule) pl-4' : ''}
        >
          {renderCard(row, { depth, hasChildren })}
        </div>
      ))}
    </div>
  );
}

function Grid<T extends RowRef>({ rows, testid, rowTestid, renderCard }: Props<T>) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6" data-testid={testid}>
      {rows.map((row) => (
        <div key={row.id} data-testid={rowTestid(row)}>
          {renderCard(row, { depth: 0, hasChildren: false })}
        </div>
      ))}
    </div>
  );
}
