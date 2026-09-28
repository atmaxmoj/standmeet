// use-resume-pages —— lays the canvas résumé out as pages (see resume-pages for the rules). After
// every render it walks the flow's unbreakable blocks in order and pushes each one that would cross a
// page's bottom margin down to the next page, then reports how many sheets to draw behind the flow.
//
// A push is extra margin-top, and margins can collapse with an ancestor's, so each push is measured
// after it is applied and topped up until the block really sits at its target.
//
// Runs inside Puck's iframe: the observers come from the flow's own window, and positions are divided
// by the canvas zoom (Puck scales the iframe body with a transform).

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

import {
  geometryFor, pageCount, paperSpec, targetTop, type PageGeometry, type PaperSize,
} from '@/lib/admin/resume-pages';

export interface ResumePages {
  flowRef: RefObject<HTMLDivElement | null>;
  pages: number;
  geometry: PageGeometry;
}

export function useResumePages(paper: PaperSize): ResumePages {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ pages: 1, geometry: geometryFor(paperSpec(paper).widthPx, paper) });

  useLayoutEffect(() => {
    const flow = flowRef.current;
    const win = flow?.ownerDocument.defaultView;
    if (!flow || !win) return undefined;
    const relayout = () => {
      const next = layoutFlow(flow, paper);
      setState((prev) => (prev.pages === next.pages && prev.geometry.pageHeight === next.geometry.pageHeight ? prev : next));
    };
    relayout();
    const resize = new win.ResizeObserver(relayout);
    resize.observe(flow);
    // text and structure changes only: the pushes themselves are attribute changes, not observed
    const mutate = new win.MutationObserver(relayout);
    mutate.observe(flow, { childList: true, subtree: true, characterData: true });
    return () => { resize.disconnect(); mutate.disconnect(); };
  }, [paper]);

  return { flowRef, ...state };
}

const TOLERANCE_PX = 0.5;
const MAX_TOP_UPS = 4;

function layoutFlow(flow: HTMLElement, paper: PaperSize): { pages: number; geometry: PageGeometry } {
  const atoms = [...flow.querySelectorAll<HTMLElement>('[data-atom]')];
  for (const a of atoms) a.style.marginTop = '';
  const geometry = geometryFor(flow.offsetWidth, paper);
  const rel = relativeTo(flow);
  atoms.forEach((a, i) => place(a, atoms[i + 1], rel, geometry));
  const last = atoms.at(-1);
  return { pages: last ? pageCount(rel(last).bottom, geometry) : 1, geometry };
}

// relativeTo —— an element's top/bottom in flow px, independent of the canvas zoom.
function relativeTo(flow: HTMLElement): (el: HTMLElement) => { top: number; bottom: number } {
  return (el) => {
    const box = flow.getBoundingClientRect();
    const zoom = flow.offsetHeight > 0 ? box.height / flow.offsetHeight : 1;
    const r = el.getBoundingClientRect();
    return { top: (r.top - box.top) / zoom, bottom: (r.bottom - box.top) / zoom };
  };
}

// place —— move one block to where it belongs; a keep-with-next heading is placed as one unit with
// the block after it.
function place(
  a: HTMLElement, next: HTMLElement | undefined,
  rel: (el: HTMLElement) => { top: number; bottom: number }, g: PageGeometry,
): void {
  const unitBottom = () => (a.hasAttribute('data-keep-next') && next ? rel(next).bottom : rel(a).bottom);
  const want = targetTop(rel(a).top, unitBottom(), g);
  const base = parseFloat(a.ownerDocument.defaultView!.getComputedStyle(a).marginTop) || 0;
  let extra = 0;
  for (let n = 0; n < MAX_TOP_UPS && want - rel(a).top > TOLERANCE_PX; n++) {
    extra += want - rel(a).top;
    a.style.marginTop = `${base + extra}px`;
  }
}
