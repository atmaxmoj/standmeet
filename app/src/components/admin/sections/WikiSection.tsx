// WikiSection —— /admin/wiki. The second of the three tiers raw → wiki → output.
// Design source docs/design/project/admin.js WikiSection: tag-chip filter
// row + 2-col grid card. Each card header has a ● public/private visibility dot;
// footer has meta (sources count · last-edited); hover/active shows edit/promote/delete.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { corpusHref } from '@/lib/corpus/href';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusEntryForm, corpusParentOptions } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { WikiEditForm, WikiPromoteRow } from '@/components/admin/sections/wiki/WikiRowForms';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { CorpusSearchRow } from '@/components/admin/sections/corpus/CorpusSearchRow';
import { TagFilterRow } from '@/components/admin/sections/corpus/TagFilterRow';
import { corpusListing, filterByTag, taggedPagePath } from '@/lib/admin/corpus-listing';
import { useCorpusSearch } from '@/lib/admin/use-corpus-search';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import { useGenreTags } from '@/lib/admin/use-genre-tags';
import { DANGER_ACTION_CLASS } from '@/lib/ui/danger-action';
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
import { stampDay } from '@/lib/ui/format-time';
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
        slug="wiki"
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
  // The tag row comes from **the whole genre**, not just the loaded page — the latter would mean
  // a tag that only exists outside that page gets no chip at all, so it's neither clickable nor
  // discoverable as missing (the second half of F-L-23).
  const tags = useGenreTags('wiki');
  // Picking a tag = switch to grid view (F-L-30). The tree is **address hierarchy** and lazy
  // loaded, `CorpusLazyTree` doesn't take rows at all, so "filtering" on the tree would just be
  // thrown away silently: the chip lights up, the tree doesn't change a single row — the screen
  // would be lying. A tag is a **flat query**, and its answer is the grid. Switching views is
  // visible, and a visible honest switch beats an invisible filter.
  const pickTag = useCallback((t: string | null) => {
    setActiveTag(t);
    t === null || setView('grid');
  }, [setActiveTag, setView]);
  // "Which collection is being shown, where does paging come from" is derived by corpusListing (that's not rendering).
  const search = useCorpusSearch('wiki');
  const listing = corpusListing({
    search, searchRows: search.rows, tagRows: filterByTag(rows, activeTag), view,
    gridSource: {
      pagePath: taggedPagePath('/corpus/wiki/page', activeTag), schema: WikiSummarySchema,
    },
  });
  // Address tree is derived + cascading delete: count descendants for each entry, warn how many
  // will also be deleted when it's deleted.
  const childCounts = descendantCounts(listing.rows);
  return (
    <>
      <CorpusSearchRow hook={search} />
      <div className="flex items-baseline justify-between gap-4 mb-5 flex-wrap">
        <TagFilterRow tags={tags} activeTag={activeTag} setActiveTag={pickTag} />
        {/* During search, grid is forced, so the toggle must show grid — otherwise it would say
            TREE while cards are on screen, and the control would be lying. */}
        <CorpusViewToggle view={listing.view} onChange={setView} />
      </div>
      <CorpusTreeGrid
        view={listing.view} rows={listing.rows} testid="wiki-list"
        rowTestid={(r) => `wiki-row-${r.id}`}
        loadChildren={loadWikiTreeChildren}
        {...listing.gridProps}
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
      {stampDay(createdAt)}
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
      href={corpusHref({ genre: 'wiki', path })} target="_blank" rel="noreferrer"
      data-testid="wiki-view-live"
      className="text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('viewLive')}
    </a>
  ) : null;
}

// RowBtn —— label is already localized by the caller (including the ↗ suffix), this just renders it.
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
      className={DANGER_ACTION_CLASS}
    >
      {t('deleteX')}
    </button>
  );
}

// deleteWikiPrompt —— when there are descendants, the warning says how many will also be
// deleted (cascading delete, no orphans left because the address tree is derived).
function deleteWikiPrompt(title: string, childCount: number): string {
  const warn = childCount > 0
    ? ` This also deletes its ${childCount} child ${childCount === 1 ? 'entry' : 'entries'}.`
    : '';
  return `Delete wiki "${title}"?${warn} This cannot be undone.`;
}
