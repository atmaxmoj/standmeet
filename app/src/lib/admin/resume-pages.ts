// resume-pages —— the résumé's paper and where it breaks into pages, shared by the editor canvas and
// the PDF.
//
// Paper (the owner's setting, default Letter): its CSS width at 96 dpi — the width the canvas sheet is
// drawn at AND the width the PDF lays out at (gotenberg prints at scale 1 on the page's own @page
// size) — and its height/width ratio. Every page has a top and a bottom margin of 6.5% of the width.
// Content is a column of unbreakable blocks ([data-atom]: a role's heading lines, one bullet, a
// school, a skill group…). A block that would cross a page's bottom margin moves to the top of the
// next page; a heading marked keep-with-next moves together with the block after it. That is what
// Chromium does when printing with `break-inside: avoid` / `break-after: avoid`, so the canvas shows
// the pages the PDF will have.

export type PaperSize = 'letter' | 'a4';

interface Paper {
  widthPx: number;
  ratio: number; // height / width
  cssMargin: string; // 6.5% of the width, in physical units for print
}

// The @page sizes themselves live in print.css as named pages (`@page letter` / `@page a4`, picked by
// the print root's data-paper) — CSS cannot take an @page size from a variable.
const PAPERS: Record<PaperSize, Paper> = {
  letter: { widthPx: 816, ratio: 11 / 8.5, cssMargin: '0.5525in' },
  a4: { widthPx: 794, ratio: 297 / 210, cssMargin: '13.65mm' },
};

export const MARGIN_RATIO = 0.065;
export const SHEET_GAP_PX = 24;

// paperOf —— normalise the stored value once at the boundary: anything but "a4" is Letter.
export function paperOf(stored: string | undefined): PaperSize {
  return stored === 'a4' ? 'a4' : 'letter';
}

export function paperSpec(p: PaperSize): Paper {
  return PAPERS[p];
}

export interface PageGeometry {
  pageHeight: number; // px
  margin: number; // px, top and bottom of every page
  gap: number; // px between sheets on the canvas
}

export function geometryFor(width: number, p: PaperSize): PageGeometry {
  return { pageHeight: width * PAPERS[p].ratio, margin: width * MARGIN_RATIO, gap: SHEET_GAP_PX };
}

const strideOf = (g: PageGeometry) => g.pageHeight + g.gap;

// targetTop —— where a block (or a heading together with the block after it) belongs: where it is
// if it sits inside a page's content area, else the top of the content area of the page it should
// start on. `top` and `bottom` are px from the top of the flow.
export function targetTop(top: number, bottom: number, g: PageGeometry): number {
  const page = Math.floor(top / strideOf(g));
  const contentTop = page * strideOf(g) + g.margin;
  const contentBottom = page * strideOf(g) + g.pageHeight - g.margin;
  return top < contentTop ? contentTop
    : bottom > contentBottom ? (page + 1) * strideOf(g) + g.margin
      : top;
}

// pageCount —— the sheets needed for content that ends at `bottom`.
export function pageCount(bottom: number, g: PageGeometry): number {
  return Math.max(1, Math.floor(bottom / strideOf(g)) + 1);
}
