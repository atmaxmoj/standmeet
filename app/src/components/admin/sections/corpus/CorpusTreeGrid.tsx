// CorpusTreeGrid —— shared body for all four corpus genres. Given a view mode it renders
// either the lazy hierarchy (CorpusLazyTree: fetches one level per expanded node, never
// the whole corpus) or the flat 2-col card wall (grid), delegating each card to the
// caller's renderCard. The grid still takes the already-loaded rows; the tree is driven
// by loadChildren(parentID) so it stays scale-safe.

'use client';

import type { ReactNode } from 'react';
import type { z } from 'zod';

import { CorpusLazyTree } from '@/components/admin/sections/corpus/CorpusLazyTree';
import { VirtualCardGrid } from '@/components/admin/sections/corpus/VirtualCardGrid';
import { buildCorpusForest } from '@/lib/admin/corpus-tree';
import type { CorpusView } from '@/lib/admin/corpus-view';

interface RowRef {
  id: string;
  parent_id?: string | null;
  has_children?: boolean;
}

type CardMeta = { depth: number; hasChildren: boolean };

interface Props<T extends RowRef> {
  view: CorpusView;
  rows: readonly T[];
  testid: string;
  rowTestid: (row: T) => string;
  // loadChildren + gridSource present → lazy tree + paginated virtual grid (raw/wiki/
  // output). Absent → the client-side forest / simple grid over already-loaded rows
  // (writings, until it gets lazy + paged endpoints of its own).
  loadChildren?: (parentID: string) => Promise<T[]>;
  gridSource?: { genre: string; schema: z.ZodType<T> };
  renderCard: (row: T, meta: CardMeta) => ReactNode;
}

export function CorpusTreeGrid<T extends RowRef>(props: Props<T>) {
  return props.view === 'tree' ? <TreeBody {...props} /> : <GridBody {...props} />;
}

function GridBody<T extends RowRef>(props: Props<T>) {
  return props.gridSource ? (
    <VirtualCardGrid
      genre={props.gridSource.genre} itemSchema={props.gridSource.schema}
      testid={props.testid} rowTestid={props.rowTestid} renderCard={props.renderCard}
    />
  ) : <Grid {...props} />;
}

function TreeBody<T extends RowRef>(props: Props<T>) {
  return props.loadChildren ? (
    <CorpusLazyTree
      load={props.loadChildren} testid={props.testid}
      rowTestid={props.rowTestid} renderCard={props.renderCard}
    />
  ) : <ForestTree {...props} />;
}

// ForestTree —— client-side hierarchy over the already-loaded rows (fallback for genres
// without a lazy endpoint yet). Indent is data-driven, so the one sanctioned inline style.
function ForestTree<T extends RowRef>({ rows, testid, rowTestid, renderCard }: Props<T>) {
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
          {renderCard(row, { depth: 0, hasChildren: row.has_children ?? false })}
        </div>
      ))}
    </div>
  );
}
