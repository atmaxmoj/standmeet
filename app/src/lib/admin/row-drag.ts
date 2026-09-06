// row-drag —— pure geometry for on-canvas row reordering (P3-b). Kept out of the overlay component
// so the presentation layer stays under its no-if / complexity caps: the component just wires pointer
// events to these.

import { anchorToPx, type SvgGeo } from '@/lib/admin/use-svg-geometry';
import type { RowAnchor } from '@/lib/admin/typst-preview';

// rowsOfKind —— the anchors for one list, in index order.
export function rowsOfKind(anchors: readonly RowAnchor[], kind: string): RowAnchor[] {
  return anchors.filter((a) => a.kind === kind).sort((p, q) => p.index - q.index);
}

// dropTargetIndex —— which row index a drop at container-y `py` lands on: the last row whose top sits
// at or above the pointer (drop below everything → the last row; above everything → the first). This
// is the index to move the dragged row TO.
export function dropTargetIndex(rows: readonly RowAnchor[], geo: SvgGeo, py: number): number {
  let target = 0;
  for (const r of rows) {
    if (anchorToPx(geo, r.x, r.y, r.page).y <= py) target = r.index;
  }
  return target;
}
