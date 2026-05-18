// PageEditor —— /admin/page section 内容。最小版：只能编 hero_prose。
// 后续会扩出 insights / projects / where / contact 的可视编辑。

'use client';

import { useCallback } from 'react';

import { SectionHeader } from './SectionHeader';

import { usePageEditor, type PageEditorState } from '@/lib/admin/use-page-editor';

export function PageEditor() {
  const editor = usePageEditor();
  return (
    <>
      <SectionHeader title="page" subtitle="edit the public-facing prose visitors see first" />
      <PageEditorBody editor={editor} />
    </>
  );
}

function PageEditorBody({ editor }: { editor: ReturnType<typeof usePageEditor> }) {
  return editor.state.kind === 'loading' ? <Loading />
    : editor.state.kind === 'error' ? <ErrorMsg message={editor.state.message} />
    : <PageEditorForm state={editor.state} setHeroProse={editor.setHeroProse} save={editor.save} />;
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function PageEditorForm({
  state, setHeroProse, save,
}: {
  state: Exclude<PageEditorState, { kind: 'loading' | 'error' }>;
  setHeroProse: (v: string) => void;
  save: () => Promise<void>;
}) {
  const onSave = useCallback(async () => { await save(); }, [save]);
  return state.kind === 'saving' ? <p className="mono text-(--color-muted)">saving…</p>
    : <PageEditorFields content={state.content} onChange={setHeroProse} onSave={onSave} savedAt={state.savedAt} dirty={state.dirty} />;
}

function PageEditorFields({
  content, onChange, onSave, savedAt, dirty,
}: {
  content: { hero_prose: string };
  onChange: (v: string) => void;
  onSave: () => Promise<void>;
  savedAt: number | null;
  dirty: boolean;
}) {
  return (
    <div className="space-y-6">
      <FieldHeroProse value={content.hero_prose} onChange={onChange} />
      <SaveBar dirty={dirty} savedAt={savedAt} onSave={onSave} />
    </div>
  );
}

function FieldHeroProse({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        hero prose
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        data-testid="hero-prose"
        className="w-full bg-transparent border border-(--color-rule) focus:border-(--color-ink) p-3 reading text-base"
      />
    </label>
  );
}

function SaveBar({
  dirty, savedAt, onSave,
}: { dirty: boolean; savedAt: number | null; onSave: () => Promise<void> }) {
  return (
    <div className="flex items-center justify-between">
      <SaveStatus dirty={dirty} savedAt={savedAt} />
      <SaveButton dirty={dirty} onSave={onSave} />
    </div>
  );
}

function SaveStatus({ dirty, savedAt }: { dirty: boolean; savedAt: number | null }) {
  return dirty ? <span className="mono text-xs text-(--color-muted)">unsaved changes</span>
    : savedAt !== null ? <span className="mono text-xs text-(--color-muted)" data-testid="saved">saved</span>
    : <span className="mono text-xs text-(--color-faint)">—</span>;
}

function SaveButton({ dirty, onSave }: { dirty: boolean; onSave: () => Promise<void> }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={!dirty}
      data-testid="save"
      className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
    >
      save
    </button>
  );
}
