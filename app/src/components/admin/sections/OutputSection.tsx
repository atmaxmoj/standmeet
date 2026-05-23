// OutputSection —— /admin/output。raw → wiki → output 三层最精炼那层。
// list + create / edit / delete。output 是链尾，没有 promote-up。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { ListFilterBar } from '@/components/admin/sections/corpus/ListFilterBar';
import { SEOEditor } from '@/components/admin/sections/corpus/SEOEditor';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type CorpusEntryInput,
  type PathUpdateInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickOutputBodyState, useOutput,
  type OutputHook, type OutputSummary,
} from '@/lib/admin/use-output';
import { useOutputDetail } from '@/lib/admin/use-corpus-detail';
import { runWith } from '@/lib/admin/use-corpus-form';
import { useListFilter, type ListFilterHook } from '@/lib/admin/use-list-filter';
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
  const filter = useListFilter<OutputSummary>({
    rows: hook.rows,
    searchText: (o) => `${o.title} ${o.tags.join(' ')}`,
  });
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <ListWithFilter filter={filter} actions={actions} />,
  } as const;
  return map[pickOutputBodyState(hook)];
}

function ListWithFilter({
  filter, actions,
}: { filter: ListFilterHook<OutputSummary>; actions: CorpusActionsHook }) {
  const toast = useToast();
  const onBatch = () => batchDeleteOutput(filter, actions, toast);
  return (
    <>
      <ListFilterBar
        testidPrefix="output"
        query={filter.query} setQuery={filter.setQuery}
        sort={filter.sort} setSort={filter.setSort}
        selectedCount={filter.selected.size}
        batchLabel={`delete ${filter.selected.size}`}
        onBatch={onBatch}
        onClearSelected={filter.clearSelected}
      />
      <OutputList rows={filter.view} actions={actions} filter={filter} />
    </>
  );
}

async function batchDeleteOutput(
  filter: ListFilterHook<OutputSummary>,
  actions: CorpusActionsHook,
  toast: { success: (m: string) => void },
): Promise<void> {
  const ok = confirm(`Delete ${filter.selected.size} output entries?`);
  ok && await runBatchDeleteOutput(filter, actions, toast);
}

async function runBatchDeleteOutput(
  filter: ListFilterHook<OutputSummary>,
  actions: CorpusActionsHook,
  toast: { success: (m: string) => void },
): Promise<void> {
  const ids = Array.from(filter.selected);
  await Promise.all(ids.map((id) => actions.deleteOutput(id)));
  filter.clearSelected();
  toast.success(`${ids.length} output entries deleted`);
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
  rows, actions, filter,
}: {
  rows: readonly OutputSummary[];
  actions: CorpusActionsHook;
  filter: ListFilterHook<OutputSummary>;
}) {
  return (
    <ul className="space-y-4" data-testid="output-list">
      {rows.map((o) => (
        <li key={o.id} data-testid={`output-row-${o.id}`}>
          <OutputCard
            entry={o} actions={actions}
            selected={filter.selected.has(o.id)}
            onToggleSelect={() => filter.toggleSelected(o.id)}
          />
        </li>
      ))}
    </ul>
  );
}

interface OutputCardProps {
  entry: OutputSummary;
  actions: CorpusActionsHook;
  selected: boolean;
  onToggleSelect: () => void;
}

function OutputCard({ entry, actions, selected, onToggleSelect }: OutputCardProps) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <div className="flex items-baseline gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          data-testid={`output-select-${entry.id}`}
          className="mt-1 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <OutputHead entry={entry} />
          <OutputTags tags={entry.tags} />
          <Provenance count={entry.source_wiki_ids.length} />
          {editing ? null : (
            <RowActions entry={entry} actions={actions} onEdit={() => setEditing(true)} />
          )}
        </div>
      </div>
      {editing ? (
        <EditForm entry={entry} actions={actions} onDone={() => setEditing(false)} />
      ) : null}
    </article>
  );
}

function Provenance({ count }: { count: number }) {
  return count === 0 ? null : (
    <p className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) mt-2">
      ↑ promoted from {count} wiki {count === 1 ? 'entry' : 'entries'}
    </p>
  );
}

function OutputHead({ entry }: { entry: OutputSummary }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <h3 className="font-serif text-(--color-ink)" style={{ fontSize: '18px', fontWeight: 500 }}>
        {entry.title}
      </h3>
      <div className="flex items-baseline gap-3">
        {entry.show_as_source ? null : (
          <span
            data-testid={`output-hidden-source-${entry.id}`}
            className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)"
          >
            hidden source
          </span>
        )}
        <ViewLiveLink path={entry.path} indexed={entry.seo_indexed} />
        <span className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)">
          {formatDate(entry.created_at)}
        </span>
      </div>
    </div>
  );
}

function ViewLiveLink({
  path, indexed,
}: { path?: string | null; indexed: boolean }) {
  return indexed && path ? (
    <a
      href={`/output/${path}`}
      target="_blank"
      rel="noreferrer"
      data-testid="output-view-live"
      className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-accent) hover:underline"
    >
      view live ↗
    </a>
  ) : null;
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
  const detail = useOutputDetail(entry.id, actions);
  const onSubmit = (input: CorpusEntryInput) => void runWith(
    () => actions.updateOutput(entry.id, input),
    () => { toast.success('Output updated'); onDone(); },
  );
  return (
    <div className="mt-4" data-testid={`output-edit-loaded-${entry.id}`}>
      {detail ? (
        <>
          <CorpusEntryForm
            initial={{
              title: detail.title,
              body: detail.body,
              tags: detail.tags,
            }}
            busy={actions.pending}
            submitLabel="save"
            testidPrefix={`output-edit-form-${entry.id}`}
            onSubmit={onSubmit}
            onCancel={onDone}
          />
          <SEOEditor
            testidPrefix={`output-${entry.id}`}
            initial={{
              path: detail.path,
              seo_description: detail.seo_description,
              seo_indexed: detail.seo_indexed,
            }}
            busy={actions.pending}
            onSave={(input: PathUpdateInput) => void saveOutputSEO(entry.id, actions, toast, input)}
          />
        </>
      ) : (
        <p className="mono text-[10.5px] text-(--color-muted)">loading…</p>
      )}
    </div>
  );
}

async function saveOutputSEO(
  id: string,
  actions: CorpusActionsHook,
  toast: { success: (m: string) => void },
  input: PathUpdateInput,
): Promise<void> {
  await runWith(
    () => actions.updateOutputSEO(id, input),
    () => toast.success('Output SEO saved'),
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
