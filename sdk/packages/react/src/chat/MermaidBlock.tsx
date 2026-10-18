// MermaidBlock —— client-side mermaid rendering (Pele, in this lazy chunk).
// It renders in an effect, not during render: Pele measures labels with the
// browser's canvas, which a server render does not have, so drawing there
// would hydrate to a different SVG.
//
// Design choice: each block renders independently to an SVG string, then
// dangerously injects it (Pele escapes diagram text and filters links and
// styles). The Suspense fallback lives in the parent.

'use client';

import { useEffect, useRef, useState } from 'react';

import { useDiagramDiagnostics } from './diagram-diagnostics.js';
import { logger } from './log.js';
import { renderMermaidSVG, type MermaidRenderResult } from './mermaid-render.js';
import { ZoomableFigure } from './ZoomableFigure.js';

interface MermaidBlockProps {
  source: string;
}

let mermaidIdCounter = 0;
function nextID(): string {
  mermaidIdCounter += 1;
  return `mermaid-${mermaidIdCounter}`;
}

function renderState(result: MermaidRenderResult | null): {
  svg: string;
  error: string | null;
} {
  return result === null ? { svg: '', error: null }
    : result.kind === 'ok' ? { svg: result.svg, error: null }
    : { svg: '', error: result.message };
}

export function MermaidBlock({ source }: MermaidBlockProps): React.ReactElement {
  const [result, setResult] = useState<MermaidRenderResult | null>(null);
  const idRef = useRef<string>(nextID());

  useEffect(() => { setResult(renderMermaidSVG(idRef.current, source)); }, [source]);

  const { svg, error } = renderState(result);
  return error !== null
    ? <FailedDiagram source={source} message={error} />
    : svg === ''
      ? <div className="smc-figure" data-testid="mermaid-svg" />
      : <ZoomableFigure svg={svg} className="smc-mermaid" testid="mermaid-svg" />;
}

// FailedDiagram —— the cell for a diagram that failed to compile. **Who's
// looking decides what it shows** (see diagram-diagnostics): the owner wants
// that error message (the model drew it wrong, and they need to see it),
// while the visitor should see nothing at all — a diagram is only
// supplementary, the body text has to stand on its own regardless, and
// mermaid's internal wording isn't the product's voice.
//
// The visitor tier isn't "silent": a failure still gets logged; the gate
// only blocks display, not the issue being known.
function FailedDiagram(
  { source, message }: { source: string; message: string },
): React.ReactElement | null {
  const diagnostics = useDiagramDiagnostics();
  logger.error('mermaid compile failed', { message, source });
  return diagnostics
    ? <pre className="smc-diagram-error" data-testid="mermaid-error">{message}</pre>
    : null;
}
