// RowDragOverlay —— on-canvas drag-to-reorder for repeatable rows (P3-b, docs/design/
// composer-visual-editor.md). For each row-anchor the template emits, a grip handle sits at that
// row on the rendered SVG; dragging one onto another row reorders the list, which recompiles the
// preview and persists — reordering the résumé ON the document, not just in the side panel.
//
// Real pointer gestures (pointer capture), not HTML5 DnD: press the grip, move, release over another
// row. Pointer capture routes the release back to the grip even if it lands elsewhere, so a real
// mouse drag (Playwright page.mouse.down/move/up) drives it exactly as a person would.

'use client';

import { useState, type RefObject } from 'react';

import { anchorToPx, type SvgGeo } from '@/lib/admin/use-svg-geometry';
import { rowsOfKind, dropTargetIndex } from '@/lib/admin/row-drag';
import type { RowAnchor } from '@/lib/admin/typst-preview';

interface Props {
  rowAnchors: readonly RowAnchor[];
  geo: SvgGeo;
  containerRef: RefObject<HTMLElement | null>;
  onReorderRow: (kind: string, from: number, to: number) => void;
}

export function RowDragOverlay({ rowAnchors, geo, containerRef, onReorderRow }: Props) {
  const [dragging, setDragging] = useState('');
  const drop = (kind: string, from: number, clientY: number) => {
    const el = containerRef.current;
    const py = el === null ? 0 : clientY - el.getBoundingClientRect().top + el.scrollTop;
    const to = dropTargetIndex(rowsOfKind(rowAnchors, kind), geo, py);
    setDragging('');
    return to === from ? undefined : onReorderRow(kind, from, to);
  };
  return (
    <>
      {rowAnchors.map((a) => (
        <RowGrip
          key={`${a.kind}-${a.index}`}
          anchor={a} geo={geo} active={dragging === `${a.kind}-${a.index}`}
          onStart={() => setDragging(`${a.kind}-${a.index}`)}
          onDrop={(clientY) => drop(a.kind, a.index, clientY)}
        />
      ))}
    </>
  );
}

function RowGrip({
  anchor, geo, active, onStart, onDrop,
}: {
  anchor: RowAnchor;
  geo: SvgGeo;
  active: boolean;
  onStart: () => void;
  onDrop: (clientY: number) => void;
}) {
  const pos = anchorToPx(geo, anchor.x, anchor.y, anchor.page);
  return (
    <button
      type="button"
      data-testid={`composer-row-drag-${anchor.kind}-${anchor.index}`}
      aria-label={`drag to reorder ${anchor.kind} ${anchor.index + 1}`}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onStart(); }}
      onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); onDrop(e.clientY); }}
      className={`absolute sm-z-raised-1 -translate-x-full -translate-y-1/2 mono text-[12px] leading-none px-1 py-0.5 rounded-[2px] select-none touch-none transition-opacity ${active ? 'opacity-100 bg-(--color-accent) text-(--color-paper)' : 'opacity-0 group-hover:opacity-100 text-(--color-faint) hover:text-(--color-muted)'}`}
      // eslint-disable-next-line no-restricted-syntax -- runtime px from the measured SVG geometry
      style={{ left: pos.x, top: pos.y, cursor: 'grab' }}
    >
      {'⠿'}
    </button>
  );
}
