// use-svg-geometry —— measures the rendered <svg> inside a scroll container, in the container's
// own content coordinates, so absolutely-positioned edit overlays (Phase 3) sit exactly over the
// résumé. Re-measures on resize (the SVG scales with the pane width) and when the SVG changes.
//
// The page is a fixed 8.5in × 11in = 612pt × 792pt (the SVG's viewBox), so an anchor's pt position
// maps to a fraction of the rendered SVG box — see anchorToPx.

'use client';

import { useEffect, useState, type RefObject } from 'react';

export interface SvgGeo {
  left: number; // px of the SVG's left edge within the container's scrollable content
  top: number;
  width: number; // rendered px size of one page
  height: number;
}

const PAGE_W_PT = 612;
const PAGE_H_PT = 792;

// anchorToPx —— an anchor (pt on `page`, 1-based) → px within the container content. Pages stack
// vertically in one SVG, so page N is offset by (N-1) page-heights.
export function anchorToPx(
  geo: SvgGeo, xPt: number, yPt: number, page: number,
): { x: number; y: number } {
  return {
    x: geo.left + (xPt / PAGE_W_PT) * geo.width,
    y: geo.top + (page - 1) * geo.height + (yPt / PAGE_H_PT) * geo.height,
  };
}

export function useSvgGeometry(ref: RefObject<HTMLElement | null>, svg: string): SvgGeo | null {
  const [geo, setGeo] = useState<SvgGeo | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = () => setGeo(measureSvg(el));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, svg]);
  return geo;
}

function measureSvg(el: HTMLElement): SvgGeo | null {
  const svgEl = el.querySelector('svg');
  if (svgEl === null) return null;
  const cr = el.getBoundingClientRect();
  const sr = svgEl.getBoundingClientRect();
  // getBoundingClientRect is viewport-relative; add scroll to get the container's content coords.
  return {
    left: sr.left - cr.left + el.scrollLeft,
    top: sr.top - cr.top + el.scrollTop,
    width: sr.width,
    height: (PAGE_H_PT / PAGE_W_PT) * sr.width, // one page's px height (SVG keeps the page ratio)
  };
}
