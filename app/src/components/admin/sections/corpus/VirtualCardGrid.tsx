// VirtualCardGrid —— the grid view, windowed. Renders only the visible rows (2 cards each)
// via @tanstack/react-virtual, measuring each row so variable-height cards (line-clamped
// excerpt, tags, an expanded inline edit form) stay aligned; pulls the next page as you
// near the end. Keeps the DOM bounded no matter how many entries load. The virtualizer's
// positioning is inherently dynamic, so the few inline styles carry a justified disable.

'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { z } from 'zod';

import { loadMoreIfNearEnd, useCorpusPage } from '@/lib/admin/use-corpus-page';

const COLS = 2;

interface RowRef {
  id: string;
  has_children?: boolean;
}

interface Props<T extends RowRef> {
  pagePath: string;
  itemSchema: z.ZodType<T>;
  testid: string;
  rowTestid: (row: T) => string;
  renderCard: (row: T, meta: { depth: number; hasChildren: boolean }) => ReactNode;
}

export function VirtualCardGrid<T extends RowRef>({
  pagePath, itemSchema, testid, rowTestid, renderCard,
}: Props<T>) {
  const page = useCorpusPage(pagePath, itemSchema);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(page.items.length / COLS);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 220,
    overscan: 4,
  });
  const vRows = virtualizer.getVirtualItems();
  const lastIndex = vRows.at(-1)?.index;

  useEffect(() => {
    loadMoreIfNearEnd(lastIndex, rowCount, page.hasMore, page.loadMore);
  }, [lastIndex, rowCount, page.hasMore, page.loadMore]);

  return (
    <div ref={scrollRef} data-testid={testid} className="max-h-[72vh] overflow-y-auto pr-1">
      <div
        // eslint-disable-next-line no-restricted-syntax -- virtualizer spacer: total height is data-driven
        style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
      >
        {vRows.map((vRow) => (
          <div
            key={vRow.key}
            data-index={vRow.index}
            ref={virtualizer.measureElement}
            // eslint-disable-next-line no-restricted-syntax -- virtualizer row: translateY offset is data-driven
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-6 pb-6">
              {page.items.slice(vRow.index * COLS, vRow.index * COLS + COLS).map((row) => (
                <div key={row.id} data-testid={rowTestid(row)}>
                  {renderCard(row, { depth: 0, hasChildren: row.has_children ?? false })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
