// ReorderableRows —— drag-to-reorder for the composer's repeatable sections (experience /
// education / social / custom). Phase 1 of the visual editor (docs/design/composer-visual-editor.md):
// real drag value with zero WASM risk. Each row carries a drag HANDLE (draggable) and is itself a
// drop target; dropping row A's handle onto row B calls onReorder(A, B) → the panel patches the
// draft with `reorder(list, A, B)`, which autosave persists and the Typst preview re-renders.
//
// Native HTML5 drag-and-drop — the platform feature, no library. Chromium (the e2e target) drives
// it via locator.dragTo. The whole row is a drop zone (not just the handle) so the target is easy to
// hit; only the handle is draggable so the row's inputs stay selectable/editable.

'use client';

import { useState, type ReactNode } from 'react';

interface Row { id: string }

interface Props<T extends Row> {
  items: readonly T[];
  onReorder: (fromId: string, toId: string) => void;
  renderItem: (item: T) => ReactNode;
  // testidPrefix keys the handles/rows: `${prefix}-drag-${id}` (handle) and `${prefix}-row-${id}`.
  testidPrefix: string;
}

export function ReorderableRows<T extends Row>({
  items, onReorder, renderItem, testidPrefix,
}: Props<T>) {
  const [dragId, setDragId] = useState('');
  const [overId, setOverId] = useState('');
  const clear = () => { setDragId(''); setOverId(''); };
  const drop = (toId: string) => {
    const from = dragId;
    clear();
    return from !== '' && from !== toId ? onReorder(from, toId) : undefined;
  };
  return (
    <>
      {items.map((item) => (
        <div
          key={item.id}
          data-testid={`${testidPrefix}-row-${item.id}`}
          onDragOver={(e) => { e.preventDefault(); setOverId(item.id); }}
          onDrop={(e) => { e.preventDefault(); drop(item.id); }}
          // A static outline marks the row the drop will land before (no undefined sm-* class —
          // those generate no CSS; check-sm-class-defined guards it).
          className={overId === item.id && dragId !== '' ? 'rounded-[3px] outline outline-2 outline-(--color-accent)' : ''}
        >
          <button
            type="button"
            draggable
            data-testid={`${testidPrefix}-drag-${item.id}`}
            aria-label="drag to reorder"
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); setDragId(item.id); }}
            onDragEnd={clear}
            className="mono text-[13px] leading-none px-1.5 py-1 -mb-1 cursor-grab select-none text-(--color-faint) hover:text-(--color-muted) bg-transparent"
          >
            {'⠿'}
          </button>
          {renderItem(item)}
        </div>
      ))}
    </>
  );
}
