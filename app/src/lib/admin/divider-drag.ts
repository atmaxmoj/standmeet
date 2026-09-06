// divider-drag —— pure geometry for the on-canvas column-resize handle. Kept out of the component so
// the presentation layer stays under its no-if / complexity caps.
//
// The handle applies on release (one update per drag), so the mapping is a simple relative one: how
// far the pointer moved, as a fraction of a page width, scaled to fr. A full page-width sweep moves
// the split by FR_PER_PAGE — enough to span the useful range in one drag. The model clamps the result
// (setLeftWidth), so this never has to worry about bounds.

const FR_PER_PAGE = 4;

// nextLeftWidth —— the new left-column width after dragging the divider `deltaPx` (right = wider left).
// pageWidthPx is one rendered page's width; a non-positive width leaves the value unchanged.
export function nextLeftWidth(current: number, deltaPx: number, pageWidthPx: number): number {
  return pageWidthPx <= 0 ? current : current + (deltaPx / pageWidthPx) * FR_PER_PAGE;
}
