// OutputSection —— /admin/output。raw → wiki → output 三层最精炼那层。
// list + create / edit / delete。output 是链尾，没有 promote-up。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Pill } from '@/components/admin/atoms/Pill';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions, type CorpusActionsHook, type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickOutputBodyState, useOutput,
  type OutputHook, type OutputSummary,
} from '@/lib/admin/use-output';
import { runWith } from '@/lib/admin/use-corpus-form';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function OutputSection() {
  const hook = useOutput();
  const actions = useCorpusActions();
  useEffectErrorToast(actions.error);
  return (
    <>
      <Header hook={hook} actions={actions} />
      <OutputBody hook={hook} actions={actions} />
    </>
  );
}

function Header({ hook, actions }: { hook: OutputHook; actions: CorpusActionsHook }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SectionHeader
        kicker="surface · polished"
        title="output"
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
      data-testid="output-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      + new output
    </button>
  );
}

function CreateForm({
  actions, onDone,
}: { actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.createOutput(input),
    () => { toast.success('Output created'); onDone(); },
  );
  return (
    <CorpusEntryForm
      busy={actions.pending}
      submitLabel="create"
      testidPrefix="output-create"
      onSubmit={onSubmit}
      onCancel={onDone}
    />
  );
}

function OutputBody({ hook, actions }: { hook: OutputHook; actions: CorpusActionsHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <OutputList rows={hook.rows} actions={actions} />,
  } as const;
  return map[pickOutputBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="output-error">
      {message}
    </p>
  );
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No output entries yet. Use + new output, promote from /admin/wiki, or call MCP{' '}
      <span className="mono">promote_wiki_to_output</span>.
    </p>
  );
}

function OutputList({
  rows, actions,
}: { rows: readonly OutputSummary[]; actions: CorpusActionsHook }) {
  return (
    <ul className="space-y-4" data-testid="output-list">
      {rows.map((o) => (
        <li key={o.id} data-testid={`output-row-${o.id}`}>
          <OutputCard entry={o} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

function OutputCard({
  entry, actions,
}: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <OutputHead entry={entry} />
      <OutputTags tags={entry.tags} />
      {editing ? null : (
        <RowActions entry={entry} actions={actions} onEdit={() => setEditing(true)} />
      )}
      {editing ? (
        <EditForm entry={entry} actions={actions} onDone={() => setEditing(false)} />
      ) : null}
    </article>
  );
}

function OutputHead({ entry }: { entry: OutputSummary }) {
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

function OutputTags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map((t) => (
        <span key={t} className="mono text-[10px] tracking-[0.08em] text-(--color-muted)">#{t}</span>
      ))}
    </div>
  );
}

function RowActions({
  entry, actions, onEdit,
}: { entry: OutputSummary; actions: CorpusActionsHook; onEdit: () => void }) {
  return (
    <div className="mt-4 flex items-baseline gap-3 mono text-[10px] tracking-[0.12em] uppercase">
      <button
        type="button"
        onClick={onEdit}
        data-testid={`output-edit-${entry.id}`}
        className="text-(--color-muted) hover:text-(--color-accent)"
      >
        edit ↗
      </button>
      <DeleteBtn entry={entry} actions={actions} />
    </div>
  );
}

function DeleteBtn({
  entry, actions,
}: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const toast = useToast();
  const onClick = () => confirm(`Delete output "${entry.title}"? This cannot be undone.`)
    ? void runWith(
      () => actions.deleteOutput(entry.id),
      () => toast.success('Output deleted'),
    )
    : null;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`output-delete-${entry.id}`}
      className="text-(--color-faint) hover:text-(--color-accent)"
    >
      delete ×
    </button>
  );
}

function EditForm({
  entry, actions, onDone,
}: { entry: OutputSummary; actions: CorpusActionsHook; onDone: () => void }) {
  const toast = useToast();
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateOutput(entry.id, input),
    () => { toast.success('Output updated'); onDone(); },
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
        testidPrefix={`output-edit-form-${entry.id}`}
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
