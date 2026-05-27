// WikiSection —— /admin/wiki。raw → wiki → output 三层中第二层。
// 设计源 docs/design/project/admin.js WikiSection (402-430)：tag-chip filter
// 行 + 2-col grid card。每张 card 头部带 ● public/private visibility dot；
// 底部 meta（sources count · last-edited）；hover/active 显 edit/promote/delete。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusEntryForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { WikiEditForm, WikiPromoteRow } from '@/components/admin/sections/wiki/WikiRowForms';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickWikiBodyState, useWiki,
  type WikiHook, type WikiSummary,
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
        kicker="corpus · curated"
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
      type="button" onClick={onClick} disabled={disabled}
      data-testid="wiki-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      + new entry
    </button>
  );
}

function CreateForm({ actions, onDone }: { actions: CorpusActionsHook; onDone: () => void }) {
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
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <ReadyBody rows={hook.rows} actions={actions} activeTag={activeTag} setActiveTag={setActiveTag} />,
  } as const;
  return map[pickWikiBodyState(hook)];
}

function ReadyBody({
  rows, actions, activeTag, setActiveTag,
}: {
  rows: readonly WikiSummary[];
  actions: CorpusActionsHook;
  activeTag: string | null;
  setActiveTag: (t: string | null) => void;
}) {
  const tags = distinctTags(rows);
  const visible = filterByTag(rows, activeTag);
  return (
    <>
      <TagFilterRow tags={tags} activeTag={activeTag} setActiveTag={setActiveTag} />
      <WikiGrid rows={visible} actions={actions} />
    </>
  );
}

function distinctTags(rows: readonly WikiSummary[]): readonly string[] {
  return Array.from(new Set(rows.flatMap((r) => r.tags))).sort();
}

function filterByTag(rows: readonly WikiSummary[], tag: string | null): readonly WikiSummary[] {
  return tag === null ? rows : rows.filter((r) => r.tags.includes(tag));
}

function TagFilterRow({
  tags, activeTag, setActiveTag,
}: {
  tags: readonly string[];
  activeTag: string | null;
  setActiveTag: (t: string | null) => void;
}) {
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap mb-5" data-testid="wiki-tag-filter">
      <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>all</Chip>
      {tags.map((t) => (
        <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>
          {t}
        </Chip>
      ))}
    </div>
  );
}

function WikiGrid({
  rows, actions,
}: { rows: readonly WikiSummary[]; actions: CorpusActionsHook }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8" data-testid="wiki-list">
      {rows.map((w) => (
        <div key={w.id} data-testid={`wiki-row-${w.id}`}>
          <WikiCard entry={w} actions={actions} />
        </div>
      ))}
    </div>
  );
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
      No wiki entries yet. Use + new entry, promote from /admin/raw, or call MCP{' '}
      <span className="mono">promote_to_wiki</span>.
    </p>
  );
}

type RowMode = 'view' | 'edit' | 'promote';

function WikiCard({
  entry, actions,
}: { entry: WikiSummary; actions: CorpusActionsHook }) {
  const [mode, setMode] = useState<RowMode>('view');
  return (
    <article className="border-t border-(--color-rule) pt-4">
      <WikiHead entry={entry} />
      <WikiExcerpt text={entry.excerpt} />
      <WikiTagsAndMeta entry={entry} />
      <RowActions entry={entry} mode={mode} actions={actions} setMode={setMode} />
      <InlineForms entry={entry} mode={mode} actions={actions} setMode={setMode} />
    </article>
  );
}

function InlineForms({
  entry, mode, actions, setMode,
}: { entry: WikiSummary; mode: RowMode; actions: CorpusActionsHook; setMode: (m: RowMode) => void }) {
  const map = {
    view: null,
    edit: <WikiEditForm entry={entry} actions={actions} onDone={() => setMode('view')} />,
    promote: <WikiPromoteRow entry={entry} actions={actions} onDone={() => setMode('view')} />,
  } as const;
  return map[mode];
}

function WikiHead({ entry }: { entry: WikiSummary }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5">
      <h3 className="font-serif text-[20px] font-normal leading-[1.25] text-(--color-ink) m-0 flex-1">
        {entry.title}
      </h3>
      <VisibilityDot indexed={entry.seo_indexed} />
    </div>
  );
}

function WikiExcerpt({ text }: { text: string }) {
  return text ? (
    <p className="reading text-[14.5px] text-(--color-muted) mt-1 mb-2.5 line-clamp-2">{text}</p>
  ) : null;
}

function VisibilityDot({ indexed }: { indexed: boolean }) {
  const label = indexed ? 'public' : 'private';
  const tone = indexed ? 'text-(--color-muted)' : 'text-(--color-accent)';
  return (
    <span className={`mono text-[9.5px] tracking-[0.16em] uppercase ${tone}`}>● {label}</span>
  );
}

function WikiTagsAndMeta({ entry }: { entry: WikiSummary }) {
  return (
    <div className="flex justify-between items-baseline mt-2 flex-wrap gap-2">
      <WikiTags tags={entry.tags} />
      <WikiMeta sources={entry.source_raw_ids.length} createdAt={entry.created_at} />
    </div>
  );
}

function WikiTags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => <Chip key={t}>{t}</Chip>)}
    </div>
  );
}

function WikiMeta({ sources, createdAt }: { sources: number; createdAt: string }) {
  return (
    <span className="mono text-[9.5px] tracking-[0.06em] text-(--color-faint)">
      {sources} {sources === 1 ? 'source' : 'sources'} · {formatDate(createdAt)}
    </span>
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
    <div className="mt-3 flex items-baseline gap-3 mono text-[10px] tracking-[0.12em] uppercase">
      <RowBtn label="edit" testid={`wiki-edit-${entry.id}`} onClick={() => setMode('edit')} />
      <RowBtn
        label="promote → output"
        testid={`wiki-promote-${entry.id}`}
        onClick={() => setMode('promote')}
      />
      <ViewLiveLink path={entry.path} indexed={entry.seo_indexed} />
      <DeleteBtn entry={entry} actions={actions} />
    </div>
  );
}

function ViewLiveLink({ path, indexed }: { path?: string | null; indexed: boolean }) {
  return indexed && path ? (
    <a
      href={`/wiki/${path}`} target="_blank" rel="noreferrer"
      data-testid="wiki-view-live"
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      view ↗
    </a>
  ) : null;
}

function RowBtn({ label, onClick, testid }: { label: string; onClick: () => void; testid: string }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testid}
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      {label} ↗
    </button>
  );
}

function DeleteBtn({ entry, actions }: { entry: WikiSummary; actions: CorpusActionsHook }) {
  const toast = useToast();
  const onClick = () => confirm(`Delete wiki "${entry.title}"? This cannot be undone.`)
    ? void runWith(
      () => actions.deleteWiki(entry.id),
      () => toast.success('Wiki deleted'),
    )
    : null;
  return (
    <button
      type="button" onClick={onClick} data-testid={`wiki-delete-${entry.id}`}
      className="text-(--color-faint) hover:text-(--color-accent)"
    >
      delete ×
    </button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
