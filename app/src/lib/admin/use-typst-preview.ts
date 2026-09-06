// use-typst-preview —— drives the composer's live WASM preview (typst-preview.ts). Recompiles the
// draft to SVG (debounced) whenever the content or template changes; exposes a status the pane uses
// to fall back to the authoritative server-PDF iframe when the WASM can't load or compile.
//
// The logic lives in lib (not the component) because the presentation layer bans `if` / caps
// complexity — the pane just lays out whatever this returns.

'use client';

import { useEffect, useRef, useState } from 'react';

import { renderResume, type EditAnchor, type RowAnchor } from '@/lib/admin/typst-preview';

export type TypstStatus = 'rendering' | 'ready' | 'failed';

interface Input {
  template: string;
  dataJSON: string;
  role: string;
  company: string;
  qrURL: string;
  enabled: boolean; // false while the owner is on the PDF view — don't compile in the background
}

const DEBOUNCE_MS = 350;

export function useTypstPreview(
  input: Input,
): {
  svg: string; anchors: readonly EditAnchor[]; rowAnchors: readonly RowAnchor[];
  sectionAnchors: readonly RowAnchor[]; status: TypstStatus;
} {
  const [svg, setSvg] = useState('');
  const [anchors, setAnchors] = useState<readonly EditAnchor[]>([]);
  const [rowAnchors, setRowAnchors] = useState<readonly RowAnchor[]>([]);
  const [sectionAnchors, setSectionAnchors] = useState<readonly RowAnchor[]>([]);
  const [status, setStatus] = useState<TypstStatus>('rendering');
  const seq = useRef(0);
  const { template, dataJSON, role, company, qrURL, enabled } = input;

  useEffect(() => {
    if (!enabled) return undefined;
    const mine = seq.current + 1;
    seq.current = mine;
    setStatus('rendering');
    const timer = setTimeout(() => {
      renderResume({ template, dataJSON, role, company, qrURL })
        .then((out) => {
          // A newer render started while this one was compiling — drop the stale result.
          if (seq.current !== mine) return;
          setSvg(out.svg);
          setAnchors(out.anchors);
          setRowAnchors(out.rowAnchors);
          setSectionAnchors(out.sectionAnchors);
          setStatus('ready');
        })
        .catch((e: unknown) => {
          // Surface why the WASM preview fell back (it's easy to lose to the fallback otherwise).
          // eslint-disable-next-line no-console
          console.error('[typst-preview] render failed:', e);
          if (seq.current === mine) setStatus('failed');
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [template, dataJSON, role, company, qrURL, enabled]);

  return { svg, anchors, rowAnchors, sectionAnchors, status };
}
