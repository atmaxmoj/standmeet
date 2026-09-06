// row-drag —— pure geometry for on-canvas row reordering (P3-b). Kept out of the overlay component
// so the presentation layer stays under its no-if / complexity caps: the component just wires pointer
// events to these.

import { anchorToPx, type SvgGeo } from '@/lib/admin/use-svg-geometry';
import type { RowAnchor } from '@/lib/admin/typst-preview';

// rowsOfKind —— the anchors for one list, in index order.
export function rowsOfKind(anchors: readonly RowAnchor[], kind: string): RowAnchor[] {
  return anchors.filter((a) => a.kind === kind).sort((p, q) => p.index - q.index);
}

// dropTargetIndex —— which row index a drop at container-y `py` lands on: the row (OTHER than the one
// being dragged, `from`) whose anchor sits NEAREST the pointer. Nearest is robust to sub-pixel
// rounding and drag direction; excluding `from` keeps it robust when rows sit close together (short
// rows whose grip boxes overlap) — the drop resolves to a neighbour instead of collapsing onto the
// dragged row itself (a no-op). Returns `from` only when there is no other row.
export function dropTargetIndex(
  rows: readonly RowAnchor[], geo: SvgGeo, py: number, from: number,
): number {
  let target = from;
  let best = Infinity;
  for (const r of rows) {
    if (r.index === from) continue;
    const d = Math.abs(anchorToPx(geo, r.x, r.y, r.page).y - py);
    if (d < best) { best = d; target = r.index; }
  }
  return target;
}
