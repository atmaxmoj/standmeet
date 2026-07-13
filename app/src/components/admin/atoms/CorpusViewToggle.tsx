// CorpusViewToggle —— the tree ⇄ grid segmented control shared by all four corpus
// genres (raw / wiki / output / writings). Tree = hierarchy (parent nesting), grid =
// the flat 2-col card wall. State lives in useCorpusView (lib/admin/corpus-view).

'use client';

import type { CorpusView } from '@/lib/admin/corpus-view';

export function CorpusViewToggle({
  view, onChange,
}: { view: CorpusView; onChange: (v: CorpusView) => void }) {
  return (
    <div
      className="inline-flex items-center border border-(--color-rule) rounded-sm overflow-hidden"
      data-testid="corpus-view-toggle"
      role="group"
      aria-label="list view"
    >
      <ViewButton label="tree" glyph="⛬" active={view === 'tree'} onClick={() => onChange('tree')} />
      <span className="w-px self-stretch bg-(--color-rule)" aria-hidden />
      <ViewButton label="grid" glyph="▦" active={view === 'grid'} onClick={() => onChange('grid')} />
    </div>
  );
}

function ViewButton({
  label, glyph, active, onClick,
}: { label: string; glyph: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={`corpus-view-${label}`}
      className={[
        'mono text-[10px] tracking-[0.16em] uppercase px-2.5 py-1 transition-colors',
        active
          ? 'bg-(--color-ink) text-(--color-paper)'
          : 'text-(--color-muted) hover:text-(--color-accent)',
      ].join(' ')}
    >
      <span aria-hidden className="mr-1">{glyph}</span>{label}
    </button>
  );
}
