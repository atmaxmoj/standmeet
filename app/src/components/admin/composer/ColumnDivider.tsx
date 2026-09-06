// ColumnDivider —— an on-canvas grab bar at the two-column boundary (the `<sm-section kind="divider">`
// anchor the template emits at the main column's left edge). Dragging it left/right rebalances the
// left vs main column widths (left_width). Drop-to-apply — one update on release, like the row grips —
// so the preview recompiles once, not on every pointer move.
//
// Real pointer gesture (pointer capture): press the bar, move, release. Playwright drives it with
// page.mouse.down/move/up exactly as a person would.

'use client';

import { useRef } from 'react';

import { anchorToPx, type SvgGeo } from '@/lib/admin/use-svg-geometry';
import { nextLeftWidth } from '@/lib/admin/divider-drag';
import type { RowAnchor } from '@/lib/admin/typst-preview';

// DIVIDER_H —— the grab bar's height in px. A tall-ish tab is easy to grab without spanning the whole
// page (which would overlap the header).
const DIVIDER_H = 120;

export function ColumnDivider({ anchor, geo, leftWidth, onSetLeftWidth }: {
  anchor: RowAnchor;
  geo: SvgGeo;
  leftWidth: number;
  onSetLeftWidth: (fr: number) => void;
}) {
  const startX = useRef(0);
  const pos = anchorToPx(geo, anchor.x, anchor.y, anchor.page);
  return (
    <button
      type="button"
      data-testid="composer-col-divider"
      aria-label="drag to resize the columns"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); startX.current = e.clientX; }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onSetLeftWidth(nextLeftWidth(leftWidth, e.clientX - startX.current, geo.width));
      }}
      className="absolute sm-z-raised-1 w-2 -translate-x-1/2 rounded-full select-none touch-none opacity-0 group-hover:opacity-100 bg-(--color-accent)/40 hover:bg-(--color-accent)/70"
      // eslint-disable-next-line no-restricted-syntax -- runtime px from the measured SVG geometry
      style={{ left: pos.x, top: pos.y, height: DIVIDER_H, cursor: 'col-resize' }}
    />
  );
}
