// MermaidBlock —— client-side mermaid rendering. Lazy-loaded (~600KB);
// mermaid initialization is decoupled from the React lifecycle (fired
// synchronously inside an effect).
//
// Design choice: each block calls mermaid.render independently to get an
// SVG string, then dangerously injects it (mermaid's own output is trusted
// SVG). The Suspense fallback lives in the parent.

'use client';

import { useEffect, useRef, useState } from 'react';

import { useDiagramDiagnostics } from '@/components/page/diagram-diagnostics';
import { logger } from '@/lib/logger';
import { renderMermaidSVG, type MermaidRenderResult } from '@/lib/mermaid-render';

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

  useEffect(() => {
    const guard = { cancelled: false };
    void renderMermaidSVG(idRef.current, source).then(
      (r) => guard.cancelled ? undefined : setResult(r),
    );
    return () => { guard.cancelled = true; };
  }, [source]);

  const { svg, error } = renderState(result);
  return error !== null
    ? <FailedDiagram source={source} message={error} />
    : <div data-testid="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
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
    ? <pre data-testid="mermaid-error">{message}</pre>
    : null;
}
