// editor-view — the microsite editor's layout gear: which panes show. Split (default) is the two-up
// side-by-side; the other two give the code or the render the full width. Pure class helpers live
// here (out of the presentation layer) so the editor component stays simple.

// EditorView — code-only / split / render-only.
export type EditorView = 'code' | 'split' | 'render';

// editorGridCls — two columns only in split; one full-width column otherwise.
export function editorGridCls(view: EditorView): string {
  return view === 'split' ? 'grid gap-4 lg:grid-cols-2 items-start' : 'grid gap-4';
}

// editorColCls — hide the column the current view drops (CSS `hidden`, not unmount, so the code and
// preview keep their state across toggles). The render column keeps its sticky offset only in split,
// where it sits beside a taller code column.
export function editorColCls(view: EditorView, col: 'code' | 'render'): string {
  const droppedBy: EditorView = col === 'code' ? 'render' : 'code';
  const sticky = col === 'render' && view === 'split';
  const base = sticky ? 'lg:sticky lg:top-4' : 'min-w-0';
  return view === droppedBy ? `${base} hidden` : base;
}
