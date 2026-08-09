// OutputSection —— /admin/output。raw → wiki → output 三层最精炼那层。
// 设计源 docs/design/project/admin.js OutputsSection：2-col card
// grid，每张 card 顶 cover-strip + visibility pill；底版面 provenance + actions。
// visibility 用现有 schema 推导：published=true → public；!published &&
// show_as_source → unlisted；其他 → private。

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import styles from '@/components/admin/sections/OutputSection.module.css';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { useCorpusView } from '@/lib/admin/corpus-view';
import { CorpusEntryForm, corpusParentOptions } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { OutputEditForm } from '@/components/admin/sections/output/OutputRowForms';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickOutputBodyState, useOutput, loadOutputTreeChildren, OutputSummarySchema,
  type OutputHook, type OutputSummary,
} from '@/lib/admin/use-output';
import { runWith } from '@/lib/admin/use-corpus-form';
import { DANGER_ACTION_CLASS } from '@/lib/ui/danger-action';
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
        action={<NewBtnGroup onClick={() => setCreating(true)} disabled={creating} />}
      />
      {creating ? (
        <div className="mb-6">
          <CreateForm actions={actions} rows={hook.rows} onDone={() => setCreating(false)} />
        </div>
      ) : null}
    </>
  );
}

// Intro —— `slugPath` 走 ICU 参数而不是 rich tag：文案里那段是字面的 `<slug>`，
// 直接写进 message 会被 rich-tag 解析器当成标签吃掉（catalog 里那一条用 ICU
// 单引号转义 `'<'` 才能吐出字面的尖括号）。
function Intro() {
  const t = useTranslations('adminCorpus.output');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t.rich('intro', {
        slugPath: t('slugPath'),
        code: (c) => <span className="mono text-(--color-ink)">{c}</span>,
        ink: (c) => <span className="mono text-(--color-ink)">{c}</span>,
        amber: (c) => <span className="mono text-(--color-amber)">{c}</span>,
        violet: (c) => <span className="mono text-(--color-violet)">{c}</span>,
      })}
    </p>
  );
}

function NewBtnGroup({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useTranslations('adminCorpus.output');
  return (
    <div className="flex items-baseline gap-2">
      <button
        type="button" onClick={onClick} disabled={disabled}
        data-testid="output-new-btn"
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('newPdf')}
      </button>
      <button
        type="button" onClick={onClick} disabled={disabled}
        data-testid="output-new-essay-btn"
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) border border-(--color-rule) px-2.5 py-1 hover:text-(--color-ink) hover:border-(--color-ink) transition-colors disabled:opacity-40"
      >
        {t('newEssay')}
      </button>
    </div>
  );
}

function CreateForm({
  actions, rows, onDone,
}: { actions: CorpusActionsHook; rows: readonly OutputSummary[]; onDone: () => void }) {
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
      parentOptions={corpusParentOptions(rows)}
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

// OutputList —— tree ⇄ grid toggle over the same cover-strip cards. Output entries
// carry parent_id/path like the rest of the corpus, so hierarchy is a real view.
function OutputList({ rows, actions }: { rows: readonly OutputSummary[]; actions: CorpusActionsHook }) {
  const [view, setView] = useCorpusView('output');
  return (
    <>
      <div className="flex justify-end mb-4">
        <CorpusViewToggle view={view} onChange={setView} />
      </div>
      <CorpusTreeGrid
        view={view} rows={rows} testid="output-list"
        rowTestid={(r) => `output-row-${r.id}`}
        loadChildren={loadOutputTreeChildren}
        gridSource={{ pagePath: '/corpus/output/page', schema: OutputSummarySchema }}
        renderCard={(row) => <OutputCard entry={row} actions={actions} />}
      />
    </>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="output-error">
      {message}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminCorpus.output');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      {t.rich('empty', { tool: (c) => <span className="mono">{c}</span> })}
    </p>
  );
}

type Visibility = 'public' | 'unlisted' | 'private';

function deriveVisibility(entry: OutputSummary): Visibility {
  return entry.published ? 'public' : (entry.show_as_source ? 'unlisted' : 'private');
}

function OutputCard({
  entry, actions,
}: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const [editing, setEditing] = useState(false);
  const visibility = deriveVisibility(entry);
  return (
    <article className="border border-(--color-rule) rounded-[3px] overflow-hidden bg-(--color-surface)/30">
      <CoverStrip entry={entry} visibility={visibility} />
      <CardBody entry={entry} actions={actions} editing={editing} setEditing={setEditing} />
    </article>
  );
}

function CoverStrip({ entry, visibility }: { entry: OutputSummary; visibility: Visibility }) {
  const t = useTranslations('adminCorpus.output');
  return (
    <div className={`relative h-[100px] border-b border-(--color-rule) overflow-hidden ${styles.coverGradient}`}>
      <span className="mono absolute top-2.5 left-3 text-[9.5px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('coverKicker', { visibility })}
      </span>
      <span className="font-serif absolute bottom-3 left-3 text-[22px] text-(--color-ink) leading-tight pr-20 line-clamp-1">
        {entry.title}
      </span>
      <VisibilityPill visibility={visibility} />
    </div>
  );
}

function VisibilityPill({ visibility }: { visibility: Visibility }) {
  const tone = visibility === 'public' ? 'border-(--color-ink) text-(--color-ink)'
    : visibility === 'unlisted' ? 'border-(--color-amber) text-(--color-amber)'
    : 'border-(--color-violet) text-(--color-violet)';
  return (
    <span className={`mono absolute top-2.5 right-3 text-[9.5px] tracking-[0.16em] uppercase border ${tone} px-1.5 py-0.5`}>
      {visibility}
    </span>
  );
}

function CardBody({
  entry, actions, editing, setEditing,
}: { entry: OutputSummary; actions: CorpusActionsHook; editing: boolean; setEditing: (b: boolean) => void }) {
  return (
    <div className="p-4">
      <Tags tags={entry.tags} />
      <StatsRow />
      <CardFoot entry={entry} actions={actions} editing={editing} setEditing={setEditing} />
      {editing ? <OutputEditForm entry={entry} actions={actions} onDone={() => setEditing(false)} /> : null}
    </div>
  );
}

function StatsRow() {
  const t = useTranslations('adminCorpus.output');
  return (
    <div className="mono text-[10px] tracking-[0.06em] text-(--color-faint) mt-2 flex items-baseline gap-2">
      <span>{t('views')}</span>
      <span>·</span>
      <span>{t('downloads')}</span>
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
  const t = useTranslations('adminCorpus.output');
  return (
    <span className="mono text-[9.5px] tracking-[0.04em] text-(--color-faint)">
      {t('pathPrefix')}{entry.path ?? entry.id}
    </span>
  );
}

function FootActions({
  entry, actions, onEdit,
}: { entry: OutputSummary; actions: CorpusActionsHook; onEdit: () => void }) {
  const t = useTranslations('adminCorpus.output');
  return (
    <div className="flex items-baseline gap-2 mono text-[10px] tracking-[0.12em] uppercase">
      <button
        type="button" onClick={onEdit} data-testid={`output-edit-${entry.id}`}
        className="text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('edit')}
      </button>
      <ViewLiveLink path={entry.path} indexed={entry.published} />
      <DeleteBtn entry={entry} actions={actions} />
    </div>
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
  const t = useTranslations('adminCorpus.output');
  return indexed && path ? (
    <a
      href={`/output/${path}`} target="_blank" rel="noreferrer"
      data-testid="output-view-live"
      className="text-(--color-accent) hover:underline"
    >
      {t('previewLive')}
    </a>
  ) : null;
}

function DeleteBtn({ entry, actions }: { entry: OutputSummary; actions: CorpusActionsHook }) {
  const t = useTranslations('adminCorpus.common');
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
      className={DANGER_ACTION_CLASS}
    >
      {t('deleteX')}
    </button>
  );
}

