// WikiSection —— /admin/wiki。raw → wiki → output 三层中第二层。
// 设计源 docs/design/project/admin.js WikiSection：tag-chip filter
// 行 + 2-col grid card。每张 card 头部带 ● public/private visibility dot；
// 底部 meta（sources count · last-edited）；hover/active 显 edit/promote/delete。

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusEntryForm, corpusParentOptions } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { WikiEditForm, WikiPromoteRow } from '@/components/admin/sections/wiki/WikiRowForms';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import { useCorpusView } from '@/lib/admin/corpus-view';
import { descendantCounts, pickExcerpt } from '@/lib/admin/corpus-tree';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type CorpusEntryInput,
} from '@/lib/admin/use-corpus-actions';
import {
  pickWikiBodyState, useWiki, loadWikiTreeChildren, WikiSummarySchema,
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

// wikiTrueCount —— the real COUNT(*) (growth), not the loaded first page. `rows.length` is capped by
// the page limit, so the header read "50 entries" against a 223-note corpus while the sidebar pulse
// — reading the same growth COUNT(*) — correctly said 223. Same class as F-L-4 (dashboard) and
// F-L-5 (raw tabs); the wiki header was the sibling surface neither swept. Growth may be undefined
// mid-load → fall back to the loaded length.
function wikiTrueCount(
  loaded: number, growth: ReturnType<typeof useCorpusGrowth>['growth'],
): number {
  return growth?.by_tier.wiki ?? loaded;
}

function Header({ hook, actions }: { hook: WikiHook; actions: CorpusActionsHook }) {
  const [creating, setCreating] = useState(false);
  const { growth } = useCorpusGrowth();
  const total = wikiTrueCount(hook.rows.length, growth);
  return (
    <>
      <SectionHeader
        kicker="corpus · curated"
        title="wiki"
        count={hook.status === 'ready' ? `${total} entries` : ''}
        action={<NewBtn onClick={() => setCreating(true)} disabled={creating} />}
      />
      {creating ? (
        <div className="mb-6">
          <CreateForm actions={actions} rows={hook.rows} onDone={() => setCreating(false)} />
        </div>
      ) : null}
    </>
  );
}

function NewBtn({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  const t = useTranslations('adminCorpus.wiki');
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      data-testid="wiki-new-btn"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {t('newEntry')}
    </button>
  );
}

function CreateForm({
  actions, rows, onDone,
}: { actions: CorpusActionsHook; rows: readonly WikiSummary[]; onDone: () => void }) {
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
      parentOptions={corpusParentOptions(rows)}
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
  const [view, setView] = useCorpusView('wiki');
  const tags = distinctTags(rows);
  const shown = filterByTag(rows, activeTag);
  // 地址树派生 + 级联删:每条算子孙数,删它时警告会连带删掉几条。
  const childCounts = descendantCounts(shown);
  return (
    <>
      <div className="flex items-baseline justify-between gap-4 mb-5 flex-wrap">
        <TagFilterRow tags={tags} activeTag={activeTag} setActiveTag={setActiveTag} />
        <CorpusViewToggle view={view} onChange={setView} />
      </div>
      <CorpusTreeGrid
        view={view} rows={shown} testid="wiki-list"
        rowTestid={(r) => `wiki-row-${r.id}`}
        loadChildren={loadWikiTreeChildren}
        gridSource={activeTag === null ? { pagePath: '/corpus/wiki/page', schema: WikiSummarySchema } : undefined}
        renderCard={(row, { hasChildren }) => (
          <WikiCard
            entry={row} actions={actions}
            childCount={childCounts[row.id] ?? 0} hasChildren={hasChildren}
          />
        )}
      />
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
  const msg = useTranslations('adminCorpus.wiki');
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap" data-testid="wiki-tag-filter">
      <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>{msg('all')}</Chip>
      {tags.map((t) => (
        <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(activeTag === t ? null : t)}>
          {t}
        </Chip>
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
  const t = useTranslations('adminCorpus.wiki');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      {t.rich('empty', { tool: (c) => <span className="mono">{c}</span> })}
    </p>
  );
}

type RowMode = 'view' | 'edit' | 'promote';

function WikiCard({
  entry, actions, childCount, hasChildren = false,
}: {
  entry: WikiSummary; actions: CorpusActionsHook;
  childCount: number; hasChildren?: boolean;
}) {
  const [mode, setMode] = useState<RowMode>('view');
  return (
    <article className="border-t border-(--color-rule) pt-4">
      <WikiHead entry={entry} childCount={childCount} hasChildren={hasChildren} />
      <WikiExcerpt excerpt={entry.excerpt} preview={entry.preview ?? ''} />
      <WikiTagsAndMeta entry={entry} />
      <RowActions
        entry={entry} mode={mode} actions={actions} setMode={setMode} childCount={childCount}
      />
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

function WikiHead({
  entry, childCount, hasChildren,
}: { entry: WikiSummary; childCount: number; hasChildren: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-1.5">
      <h3 className="font-serif text-[20px] font-normal leading-[1.25] text-(--color-ink) m-0 flex-1">
        {entry.title}
        {hasChildren ? (
          <span className="ml-2 mono text-[9.5px] tracking-[0.08em] text-(--color-faint) align-middle">
            {'▾'} {childCount}
          </span>
        ) : null}
      </h3>
      <VisibilityDot indexed={entry.published} />
    </div>
  );
}

function WikiExcerpt({ excerpt, preview }: { excerpt: string; preview: string }) {
  const text = pickExcerpt(excerpt, preview);
  return text ? (
    <p className="reading text-[14.5px] text-(--color-muted) mt-1 mb-2.5 line-clamp-2">{text}</p>
  ) : null;
}

function VisibilityDot({ indexed }: { indexed: boolean }) {
  const t = useTranslations('adminCorpus.wiki');
  const tone = indexed ? 'text-(--color-muted)' : 'text-(--color-accent)';
  return (
    <span className={`mono text-[9.5px] tracking-[0.16em] uppercase ${tone}`}>
      {indexed ? t('dotPublic') : t('dotPrivate')}
    </span>
  );
}

function WikiTagsAndMeta({ entry }: { entry: WikiSummary }) {
  return (
    <div className="flex justify-between items-baseline mt-2 flex-wrap gap-2">
      <WikiTags tags={entry.tags} />
      <WikiMeta createdAt={entry.created_at} />
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

function WikiMeta({ createdAt }: { createdAt: string }) {
  return (
    <span className="mono text-[9.5px] tracking-[0.06em] text-(--color-faint)">
      {formatDate(createdAt)}
    </span>
  );
}

interface ActionsProps {
  entry: WikiSummary;
  mode: RowMode;
  actions: CorpusActionsHook;
  setMode: (m: RowMode) => void;
  childCount: number;
}

function RowActions({ entry, mode, actions, setMode, childCount }: ActionsProps) {
  return mode === 'view' ? (
    <ActionRow entry={entry} actions={actions} setMode={setMode} childCount={childCount} />
  ) : null;
}

function ActionRow({
  entry, actions, setMode, childCount,
}: {
  entry: WikiSummary; actions: CorpusActionsHook;
  setMode: (m: RowMode) => void; childCount: number;
}) {
  const t = useTranslations('adminCorpus.wiki');
  return (
    <div className="mt-3 flex items-baseline gap-3 mono text-[10px] tracking-[0.12em] uppercase">
      <RowBtn label={t('edit')} testid={`wiki-edit-${entry.id}`} onClick={() => setMode('edit')} />
      <RowBtn
        label={t('promoteToOutput')}
        testid={`wiki-promote-${entry.id}`}
        onClick={() => setMode('promote')}
      />
      <ViewLiveLink path={entry.path} indexed={entry.published} />
      <DeleteBtn entry={entry} actions={actions} childCount={childCount} />
    </div>
  );
}

function ViewLiveLink({ path, indexed }: { path?: string | null; indexed: boolean }) {
  const t = useTranslations('adminCorpus.wiki');
  return indexed && path ? (
    <a
      href={`/wiki/${path}`} target="_blank" rel="noreferrer"
      data-testid="wiki-view-live"
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('viewLive')}
    </a>
  ) : null;
}

// RowBtn —— label 已由调用方本地化（含 ↗ 后缀），这里只渲染。
function RowBtn({ label, onClick, testid }: { label: string; onClick: () => void; testid: string }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testid}
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      {label}
    </button>
  );
}

function DeleteBtn({
  entry, actions, childCount,
}: { entry: WikiSummary; actions: CorpusActionsHook; childCount: number }) {
  const t = useTranslations('adminCorpus.common');
  const toast = useToast();
  const onClick = () => confirm(deleteWikiPrompt(entry.title, childCount))
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
      {t('deleteX')}
    </button>
  );
}

// deleteWikiPrompt —— 有子孙时警告会连带删掉几条(级联删,地址树派生不留孤儿)。
function deleteWikiPrompt(title: string, childCount: number): string {
  const warn = childCount > 0
    ? ` This also deletes its ${childCount} child ${childCount === 1 ? 'entry' : 'entries'}.`
    : '';
  return `Delete wiki "${title}"?${warn} This cannot be undone.`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
