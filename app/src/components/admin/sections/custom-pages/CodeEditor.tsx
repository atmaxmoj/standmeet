// CodeEditor — a small, syntax-highlighted editor for the page source.
//
// **Why this exists**: the source field used to be a bare <textarea>. The owner's
// words: "at least give me a simple editor, I can't keep writing raw in this box —
// and for a light editor like this, better to pull an MIT-licensed one." So this is
// a thin wrapper over @uiw/react-textarea-code-editor (MIT): JSX highlighting and
// Tab-to-indent come from the library, we own only the testid, the border, and the
// value/onChange shape — so swapping the library later touches this file alone.
//
// Loaded via next/dynamic with ssr:false: the editor pulls in rehype/prism (ESM,
// browser-oriented) and renders only on the client, so server-rendering it just
// risks a hydration mismatch for a control the owner can't use until JS loads anyway.

'use client';

import dynamic from 'next/dynamic';

const TextareaCodeEditor = dynamic(
  () => import('@uiw/react-textarea-code-editor').then((m) => m.default),
  { ssr: false },
);

export function CodeEditor(
  { value, onChange, testId, rows = 16 }:
  { value: string; onChange: (v: string) => void; testId: string; rows?: number },
) {
  return (
    <div className="border border-(--color-rule) focus-within:border-(--color-ink) rounded-sm overflow-hidden mono text-[12px]">
      <TextareaCodeEditor
        value={value}
        language="jsx"
        // data-testid is forwarded verbatim onto the library's inner <textarea>
        // (Editor.tsx builds `textareaProps = { ...other }` and renders
        // `<textarea {...textareaProps} />`), so it lands on the real DOM node that
        // e2e fills — a raw-DOM testid, not a testid on an abstract component.
        // eslint-disable-next-line react/forbid-component-props -- forwarded to the inner <textarea>
        data-testid={testId}
        data-color-mode="light"
        onChange={(e) => onChange(e.target.value)}
        padding={10}
        minHeight={rows * 18}
      />
    </div>
  );
}
