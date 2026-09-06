// EditorViewToggle — the editor's layout gear: code-only / split / render-only. A mono segmented
// control in the house style; the active segment is inked.

'use client';

import { useTranslations } from 'next-intl';

import type { EditorView } from '@/lib/admin/editor-view';

export function EditorViewToggle(
  { view, onChange }: { view: EditorView; onChange: (v: EditorView) => void },
) {
  const t = useTranslations('adminPages.microsites');
  return (
    <div
      className="mb-3 inline-flex border border-(--color-rule) rounded-[3px] overflow-hidden"
      data-testid="editor-view-toggle"
    >
      <Seg v="code" label={t('viewCode')} view={view} onChange={onChange} />
      <Seg v="split" label={t('viewSplit')} view={view} onChange={onChange} />
      <Seg v="render" label={t('viewRender')} view={view} onChange={onChange} />
    </div>
  );
}

function Seg(
  { v, label, view, onChange }:
  { v: EditorView; label: string; view: EditorView; onChange: (v: EditorView) => void },
) {
  const active = view === v;
  return (
    <button
      type="button" onClick={() => onChange(v)} data-testid={`editor-view-${v}`}
      aria-pressed={active}
      className={`px-2.5 py-1 mono text-[10px] tracking-[0.14em] uppercase transition-colors ${
        active ? 'text-(--color-paper) bg-(--color-ink)' : 'text-(--color-muted) hover:text-(--color-ink)'
      }`}
    >
      {label}
    </button>
  );
}
