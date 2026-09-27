// CorpusTreeGrid —— shared body for every corpus genre. Given a view mode it renders either
// the lazy hierarchy (CorpusLazyTree: fetches one level per expanded node, never the whole
// corpus) or the flat 2-col card wall (VirtualCardGrid over the section's paged list),
// delegating each card to the caller's renderCard.

'use client';

import type { ReactNode } from 'react';

import { CorpusLazyTree } from '@/components/admin/sections/corpus/CorpusLazyTree';
import { VirtualCardGrid } from '@/components/admin/sections/corpus/VirtualCardGrid';
import type { GridMore } from '@/lib/admin/corpus-listing';
import type { CorpusView } from '@/lib/admin/corpus-view';

interface RowRef {
  id: string;
  parent_id?: string | null;
  has_children?: boolean;
}

type CardMeta = { depth: number; hasChildren: boolean };

interface Props<T extends RowRef> {
  view: CorpusView;
  // rows + more —— the grid's rows and how to get the next page (a section's paged list, or
  // search hits with nothing more to load).
  rows: readonly T[];
  more: GridMore;
  testid: string;
  rowTestid: (row: T) => string;
  loadChildren: (parentID: string) => Promise<T[]>;
  renderCard: (row: T, meta: CardMeta) => ReactNode;
}

export function CorpusTreeGrid<T extends RowRef>(props: Props<T>) {
  return props.view === 'tree' ? (
    <CorpusLazyTree
      load={props.loadChildren} testid={props.testid}
      rowTestid={props.rowTestid} renderCard={props.renderCard}
    />
  ) : (
    <VirtualCardGrid
      rows={props.rows} more={props.more}
      testid={props.testid} rowTestid={props.rowTestid} renderCard={props.renderCard}
    />
  );
}
