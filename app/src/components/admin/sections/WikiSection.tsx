// WikiSection —— /admin/wiki。raw → wiki → output 三层中第二层。
// 列表 + create / edit / delete / promote-to-output 操作。promote 走
// inline form 收 title + visibility + tags（body 复用源 wiki body）。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Pill } from '@/components/admin/atoms/Pill';
import { CorpusEntryForm, PromoteForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type CorpusEntryInput,
  type PromoteInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickWikiBodyState,
  useWiki,
  type WikiHook,
  type WikiSummary,
} from '@/lib/admin/use-wiki';
import { runWith } from '@/lib/admin/use-corpus-form';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function WikiSection() {
  const hook = useWiki();
  const actions = useCorpusActions();
  useEffectErrorToast(actions.error);
  return (
    <>
      <Header hook={hook} actions={actions} />
      <WikiBody hook={hook} actions={actions} />
    </>
  );
}

function Header({ hook, actions }: { hook: WikiHook; actions: CorpusActionsHook }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SectionHeader
        kicker="surface · curated"
        title="wiki"
        count={hook.status === 'ready' ? `${hook.rows.length} entries` : ''}
        action={<NewBtn onClick={() => setCreating(true)} disabled={creating} />}
      />
      {creating ? (
        <div className="mb-6">
          <CreateForm actions={actions} onDone={() => setCreating(false)} />
        </div>
      ) : null}
    </>
  );
}

function NewBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="wiki-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      + new wiki
    </button>
  );
}

function CreateForm({
  actions, onDone,
}: { actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.createWiki(input),
    () => { toast.success('Wiki created'); onDone(); },
  );
  return (
    <CorpusEntryForm
      busy={actions.pending}
      submitLabel="create"
      testidPrefix="wiki-create"
      onSubmit={onSubmit}
      onCancel={onDone}
    />
  );
}

function WikiBody({ hook, actions }: { hook: WikiHook; actions: CorpusActionsHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <WikiList rows={hook.rows} actions={actions} />,
  } as const;
  return map[pickWikiBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="wiki-error">
      {message}
    </p>
  );
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No wiki entries yet. Use + new wiki, promote from /admin/raw, or call MCP{' '}
      <span className="mono">promote_to_wiki</span>.
    </p>
  );
}

function WikiList({
  rows, actions,
}: { rows: readonly WikiSummary[]; actions: CorpusActionsHook }) {
  return (
    <ul className="space-y-4" data-testid="wiki-list">
      {rows.map((w) => (
        <li key={w.id} data-testid={`wiki-row-${w.id}`}>
          <WikiCard entry={w} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

type RowMode = 'view' | 'edit' | 'promote';

function WikiCard({
  entry, actions,
}: { entry: WikiSummary; actions: CorpusActionsHook }) {
  const [mode, setMode] = useState<RowMode>('view');
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <WikiHead entry={entry} />
      <WikiTags tags={entry.tags} />
      <RowActions
        entry={entry} mode={mode} actions={actions} setMode={setMode}
      />
      {mode === 'edit' ? (
        <EditForm entry={entry} actions={actions} onDone={() => setMode('view')} />
      ) : null}
      {mode === 'promote' ? (
        <PromoteRow entry={entry} actions={actions} onDone={() => setMode('view')} />
      ) : null}
    </article>
  );
}

function WikiHead({ entry }: { entry: WikiSummary }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <h3 className="font-serif text-(--color-ink)" style={{ fontSize: '18px', fontWeight: 500 }}>
        {entry.title}
      </h3>
      <div className="flex items-baseline gap-3">
        <Pill tone={entry.visibility === 'public' ? 'accent' : 'muted'}>{entry.visibility}</Pill>
        <span className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)">
          {formatDate(entry.created_at)}
        </span>
      </div>
    </div>
  );
}

function WikiTags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map((t) => (
        <span key={t} className="mono text-[10px] tracking-[0.08em] text-(--color-muted)">#{t}</span>
      ))}
    </div>
  );
}

interface ActionsProps {
  entry: WikiSummary;
  mode: RowMode;
  actions: CorpusActionsHook;
  setMode: (m: RowMode) => void;
}

function RowActions({ entry, mode, actions, setMode }: ActionsProps) {
  return mode === 'view' ? <ActionRow entry={entry} actions={actions} setMode={setMode} /> : null;
}

function ActionRow({
  entry, actions, setMode,
}: { entry: WikiSummary; actions: CorpusActionsHook; setMode: (m: RowMode) => void }) {
  return (
    <div className="mt-4 flex items-baseline gap-3 mono text-[10px] tracking-[0.12em] uppercase">
      <RowBtn label="edit" testid={`wiki-edit-${entry.id}`} onClick={() => setMode('edit')} />
      <RowBtn
        label="promote → output"
        testid={`wiki-promote-${entry.id}`}
        onClick={() => setMode('promote')}
      />
      <DeleteBtn entry={entry} actions={actions} />
    </div>
  );
}

function RowBtn({ label, onClick, testid }: { label: string; onClick: () => void; testid: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      {label} ↗
    </button>
  );
}

function DeleteBtn({
  entry, actions,
}: { entry: WikiSummary; actions: CorpusActionsHook }) {
  const toast = useToast();
  const onClick = () => confirm(`Delete wiki "${entry.title}"? This cannot be undone.`)
    ? void runWith(
      () => actions.deleteWiki(entry.id),
      () => toast.success('Wiki deleted'),
    )
    : null;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`wiki-delete-${entry.id}`}
      className="text-(--color-faint) hover:text-(--color-accent)"
    >
      delete ×
    </button>
  );
}

function EditForm({
  entry, actions, onDone,
}: { entry: WikiSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateWiki(entry.id, input),
    () => { toast.success('Wiki updated'); onDone(); },
  );
  return (
    <div className="mt-4">
      <CorpusEntryForm
        initial={{
          title: entry.title,
          body: '',
          visibility: entry.visibility as CorpusEntryInput['visibility'],
          tags: entry.tags,
        }}
        busy={actions.pending}
        submitLabel="save"
        testidPrefix={`wiki-edit-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
      />
    </div>
  );
}

function PromoteRow({
  entry, actions, onDone,
}: { entry: WikiSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: PromoteInput) => void runWith(
    () => actions.promoteWiki(entry.id, input),
    () => { toast.success('Promoted to output'); onDone(); },
  );
  return (
    <div className="mt-4">
      <PromoteForm
        busy={actions.pending}
        defaultTitle={entry.title}
        testidPrefix={`wiki-promote-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
      />
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
