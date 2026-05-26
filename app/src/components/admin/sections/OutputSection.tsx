// OutputSection —— /admin/output。raw → wiki → output 三层最精炼那层。
// 设计源 docs/design/project/admin.js OutputsSection (434-510)：2-col card
// grid，每张 card 顶 cover-strip + tier pill；底版面 provenance + actions。
// tier 用现有 schema 推导：seo_indexed=true → public；!seo_indexed &&
// show_as_source → unlisted；其他 → private。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
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
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function OutputSection() {
  const hook = useOutput();
  const actions = useCorpusActions();
  useEffectErrorToast(actions.error);
  return (
    <>
      <Header hook={hook} actions={actions} />
      <Intro />
      <OutputBody hook={hook} actions={actions} />
    </>
  );
}

function Header({ hook, actions }: { hook: OutputHook; actions: CorpusActionsHook }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SectionHeader
        kicker="corpus · public-facing"
        title="outputs"
        count={hook.status === 'ready' ? `${hook.rows.length} artifacts` : ''}
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

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Outputs are public-facing artifacts assembled from your wiki entries — downloadable PDFs,
      standalone web essays, investor decks. Each gets its own SEO landing at{' '}
      <span className="mono text-(--color-ink)">/output/&lt;slug&gt;</span>. Three tiers:{' '}
      <span className="mono text-(--color-ink)">public</span> (open to anyone, in sitemap),{' '}
      <span className="mono text-(--color-amber)">unlisted</span> (only visible with a code),{' '}
      <span className="mono text-(--color-violet)">private</span> (specific code scopes only, never indexed).
    </p>
  );
}

function NewBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      data-testid="output-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      + new output
    </button>
  );
}

function CreateForm({ actions, onDone }: { actions: CorpusActionsHook; onDone: () => void }) {
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
    list: <OutputGrid rows={hook.rows} actions={actions} />,
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

function OutputGrid({
  rows, actions,
}: { rows: readonly OutputSummary[]; actions: CorpusActionsHook }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="output-list">
      {rows.map((o) => (
        <div key={o.id} data-testid={`output-row-${o.id}`}>
          <OutputCard entry={o} actions={actions} />
        </div>
      ))}
    </div>
  );
}

type Tier = 'public' | 'unlisted' | 'private';

function deriveTier(entry: OutputSummary): Tier {
  return entry.seo_indexed ? 'public' : (entry.show_as_source ? 'unlisted' : 'private');
}

function OutputCard({
  entry, actions,
}: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const [editing, setEditing] = useState(false);
  const tier = deriveTier(entry);
  return (
    <article className="border border-(--color-rule) rounded-[3px] overflow-hidden bg-(--color-surface)/30">
      <CoverStrip entry={entry} tier={tier} />
      <CardBody entry={entry} actions={actions} editing={editing} setEditing={setEditing} />
    </article>
  );
}

function CoverStrip({ entry, tier }: { entry: OutputSummary; tier: Tier }) {
  return (
    <div className="relative h-[100px] border-b border-(--color-rule) bg-(--color-surface) overflow-hidden">
      <span className="mono absolute top-2.5 left-3 text-[9.5px] tracking-[0.18em] uppercase text-(--color-muted)">
        output · {tier}
      </span>
      <span className="font-serif absolute bottom-3 left-3 text-[22px] text-(--color-ink) leading-tight pr-20 line-clamp-1">
        {entry.title}
      </span>
      <TierPill tier={tier} />
    </div>
  );
}

function TierPill({ tier }: { tier: Tier }) {
  const tone = tier === 'public' ? 'border-(--color-ink) text-(--color-ink)'
    : tier === 'unlisted' ? 'border-(--color-amber) text-(--color-amber)'
    : 'border-(--color-violet) text-(--color-violet)';
  return (
    <span className={`mono absolute top-2.5 right-3 text-[9.5px] tracking-[0.16em] uppercase border ${tone} px-1.5 py-0.5`}>
      {tier}
    </span>
  );
}

function CardBody({
  entry, actions, editing, setEditing,
}: { entry: OutputSummary; actions: CorpusActionsHook; editing: boolean; setEditing: (b: boolean) => void }) {
  return (
    <div className="p-4">
      <Provenance count={entry.source_wiki_ids.length} />
      <Tags tags={entry.tags} />
      <CardFoot entry={entry} actions={actions} editing={editing} setEditing={setEditing} />
      {editing ? <EditForm entry={entry} actions={actions} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}

function CardFoot({
  entry, actions, editing, setEditing,
}: { entry: OutputSummary; actions: CorpusActionsHook; editing: boolean; setEditing: (b: boolean) => void }) {
  return (
    <div className="flex justify-between items-baseline mt-3 pt-2.5 border-t border-(--color-rule)/60">
      <FootSlug entry={entry} />
      {editing ? null : <FootActions entry={entry} actions={actions} onEdit={() => setEditing(true)} />}
    </div>
  );
}

function FootSlug({ entry }: { entry: OutputSummary }) {
  return (
    <span className="mono text-[9.5px] tracking-[0.04em] text-(--color-faint)">
      /output/{entry.path ?? entry.id}
    </span>
  );
}

function FootActions({
  entry, actions, onEdit,
}: { entry: OutputSummary; actions: CorpusActionsHook; onEdit: () => void }) {
  return (
    <div className="flex items-baseline gap-2 mono text-[10px] tracking-[0.12em] uppercase">
      <button
        type="button" onClick={onEdit} data-testid={`output-edit-${entry.id}`}
        className="text-(--color-muted) hover:text-(--color-accent)"
      >
        edit
      </button>
      <ViewLiveLink path={entry.path} indexed={entry.seo_indexed} />
      <DeleteBtn entry={entry} actions={actions} />
    </div>
  );
}

function Provenance({ count }: { count: number }) {
  return count === 0 ? null : (
    <p className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)">
      ↑ promoted from {count} wiki {count === 1 ? 'entry' : 'entries'}
    </p>
  );
}

function Tags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="mono text-[10px] tracking-[0.08em] text-(--color-muted)">#{t}</span>
      ))}
    </div>
  );
}

function ViewLiveLink({ path, indexed }: { path?: string | null; indexed: boolean }) {
  return indexed && path ? (
    <a
      href={`/output/${path}`} target="_blank" rel="noreferrer"
      data-testid="output-view-live"
      className="text-(--color-accent) hover:underline"
    >
      preview ↗
    </a>
  ) : null;
}

function DeleteBtn({ entry, actions }: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const toast = useToast();
  const onClick = () => confirm(`Delete output "${entry.title}"? This cannot be undone.`)
    ? void runWith(
      () => actions.deleteOutput(entry.id),
      () => toast.success('Output deleted'),
    )
    : null;
  return (
    <button
      type="button" onClick={onClick} data-testid={`output-delete-${entry.id}`}
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
        <EditFormBody entry={entry} detail={detail} actions={actions} onSubmit={onSubmit} onDone={onDone} />
      ) : (
        <p className="mono text-[10.5px] text-(--color-muted)">loading…</p>
      )}
    </div>
  );
}

function EditFormBody({
  entry, detail, actions, onSubmit, onDone,
}: {
  entry: OutputSummary;
  detail: { title: string; body: string; tags: string[]; path?: string | null; seo_description: string; seo_indexed: boolean };
  actions: CorpusActionsHook;
  onSubmit: (input: CorpusEntryInput) => void;
  onDone: () => void;
}) {
  const toast = useToast();
  return (
    <>
      <CorpusEntryForm
        initial={{ title: detail.title, body: detail.body, tags: detail.tags }}
        busy={actions.pending}
        submitLabel="save"
        testidPrefix={`output-edit-form-${entry.id}`}
        onSubmit={onSubmit}
        onCancel={onDone}
      />
      <SEOEditor
        testidPrefix={`output-${entry.id}`}
        initial={{ path: detail.path, seo_description: detail.seo_description, seo_indexed: detail.seo_indexed }}
        busy={actions.pending}
        onSave={(input: PathUpdateInput) => void saveOutputSEO(entry.id, actions, toast, input)}
      />
    </>
  );
}

async function saveOutputSEO(
  id: string, actions: CorpusActionsHook,
  toast: { success: (m: string) => void }, input: PathUpdateInput,
): Promise<void> {
  await runWith(
    () => actions.updateOutputSEO(id, input),
    () => toast.success('Output SEO saved'),
  );
}
