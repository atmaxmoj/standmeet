// diagram-diagnostics.tsx —— when a diagram fails to compile, who gets told.
//
// The same `MermaidBlock` renders in front of two audiences: the **visitor**
// (chat replies, public notes) and the **owner** (reviewing transcripts in
// admin). A compile failure means something completely different to each:
//
//   - Visitor: the diagram is only supplementary, and the body text has to
//     stand on its own regardless. So that cell shows **nothing at all** —
//     never smear the mermaid library's raw parse error across the reader's
//     face (the flip side of the same rule as
//     [[collapsed-error-class-kills-its-own-branch]]: the product's own
//     errors shouldn't speak in a third-party library's wording).
//   - Owner: the error message is exactly what they want — the model drew
//     the diagram wrong, and they need to see it. The gate must never hide
//     this issue from them.
//
// The default is the **visitor** tier: when a newly added rendering entry
// point forgets to declare its audience, the worst outcome is a missing
// diagnostic, not leaking the parser's wording to the reader (fail-closed).

'use client';

import { createContext, useContext } from 'react';

const DiagramDiagnosticsContext = createContext(false);

// DiagramDiagnostics —— inside the wrapped render region, a compile failure shows its diagnostic (used by the owner surface).
export function DiagramDiagnostics(
  { children }: { children: React.ReactNode },
): React.ReactElement {
  return (
    <DiagramDiagnosticsContext.Provider value>
      {children}
    </DiagramDiagnosticsContext.Provider>
  );
}

// useDiagramDiagnostics —— should this cell show the compile error. Defaults to false (visitor).
export function useDiagramDiagnostics(): boolean {
  return useContext(DiagramDiagnosticsContext);
}
