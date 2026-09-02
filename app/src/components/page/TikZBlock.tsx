// TikZBlock —— client-side rendering of a ` ```tikz ` block. Source is
// POSTed to /render-tikz (the server uses node-tikzjax — the same engine as
// obsidian-tikzjax — to render it to SVG) → injected. The heavy WASM stays
// server-side; the client only gets the SVG. Same pattern as MermaidBlock
// (three states loading/error/ok, presentation only reads state via a
// ternary branch).

'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';

import { useDiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { logger } from '@/lib/logger';

type TikZState =
  | { kind: 'loading' }
  | { kind: 'ok'; svg: string }
  | { kind: 'error' };

const TikzResSchema = z.object({ svg: z.string().optional() });

export function TikZBlock({ source }: { source: string }): React.ReactElement {
  const [state, setState] = useState<TikZState>({ kind: 'loading' });

  useEffect(() => {
    const guard = { cancelled: false };
    void fetchTikz(source).then((s) => (guard.cancelled ? undefined : setState(s)));
    return () => { guard.cancelled = true; };
  }, [source]);

  return state.kind === 'ok'
    ? (
      // The diagram is **centered** within its own cell, and must never blow
      // out the body column: the SVG carries the fixed width/height TeX laid
      // it out with, and on a narrower column it would push straight past
      // the edge. max-w-full + h-auto lets it scale proportionally, and if
      // that's still not enough it scrolls horizontally inside this cell
      // without affecting the page itself.
      <div
        data-testid="tikz-svg"
        className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
    : <PendingDiagram source={source} kind={state.kind} />;
}

// PendingDiagram —— the cell for a diagram that hasn't rendered yet. **The
// LaTeX source must never be printed to the reader**: a diagram is only
// supplementary, the body text has to stand on its own regardless, and
// `\begin{tikzpicture}` isn't the product's voice. This is the same decision
// as MermaidBlock's FailedDiagram — the owner sees the diagnostic, the
// visitor sees nothing — this file originally missed that, so a render
// failure dumped a whole block of LaTeX on the reader.
//
// loading belongs here too: with the engine running serially, on a page with
// multiple diagrams the later ones can wait several seconds, and those
// seconds definitely shouldn't show source either.
function PendingDiagram(
  { source, kind }: { source: string; kind: 'loading' | 'error' },
): React.ReactElement | null {
  const diagnostics = useDiagramDiagnostics();
  const failed = kind === 'error';
  useEffect(() => {
    void (failed && logger.error('tikz render failed', { source }));
  }, [failed, source]);
  return failed
    ? diagnostics ? <pre data-testid="tikz-error" className="text-(--color-muted)">{source}</pre> : null
    : <div data-testid="tikz-loading" className="my-6 h-24 animate-pulse bg-(--color-rule)/30" />;
}

function fetchTikz(source: string): Promise<TikZState> {
  return fetch('/render-tikz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('http'))))
    .then((data) => TikzResSchema.parse(data))
    .then((d): TikZState => (d.svg === undefined ? { kind: 'error' } : { kind: 'ok', svg: d.svg }))
    .catch((): TikZState => ({ kind: 'error' }));
}
