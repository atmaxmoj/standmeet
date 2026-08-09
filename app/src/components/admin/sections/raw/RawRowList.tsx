// RawRowList —— Raw section 列表。空时显示 "no raw entries yet" 提示。
// row actions: promote → wiki / edit / delete，都已接 backend PATCH/DELETE/POST 端点。

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusAssetsPanel } from '@/components/admin/sections/corpus/CorpusAssetsPanel';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { HeroFields, PromoteForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { useCorpusView } from '@/lib/admin/corpus-view';
import { loadRawTreeChildren } from '@/lib/admin/use-raw';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type PromoteInput,
} from '@/lib/admin/use-corpus-actions';
import { heroInput, useRawHeroForm } from '@/lib/admin/use-corpus-detail';
import { appendBlock, runWith } from '@/lib/admin/use-corpus-form';
import { DANGER_ACTION_CLASS } from '@/lib/ui/danger-action';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

import type { RawAdminView } from '@/lib/api/admin';

type Props = { rows: readonly RawAdminView[] };

export function RawRowList({ rows }: Props) {
  const actions = useCorpusActions();
  const [view, setView] = useCorpusView('raw');
  useEffectErrorToast(actions.error);
  return rows.length === 0 ? <EmptyState /> : (
    <>
      <div className="flex justify-end mb-4">
        <CorpusViewToggle view={view} onChange={setView} />
      </div>
      <CorpusTreeGrid
        view={view} rows={rows} testid="raw-list"
        rowTestid={(r) => `raw-row-${r.id}`}
        loadChildren={loadRawTreeChildren}
        renderCard={(row, { hasChildren }) => (
          <RawRow row={row} actions={actions} hasChildren={hasChildren} />
        )}
      />
    </>
  );
}

function EmptyState() {
  const t = useTranslations('adminCorpus.raw');
  return (
    <div data-testid="raw-list" className="border-t border-(--color-rule)/70">
      <p className="py-8 reading italic text-(--color-muted) text-center">
        {t('empty')}
      </p>
    </div>
  );
}

type RawMode = 'view' | 'edit' | 'promote';

function RawRow({
  row, actions, hasChildren = false,
}: { row: RawAdminView; actions: CorpusActionsHook; hasChildren?: boolean }) {
  const [mode, setMode] = useState<RawMode>('view');
  // Row testid is on the CorpusTreeGrid wrapper — don't duplicate it here.
  return (
    <div className="border-b border-(--color-rule)/70 py-4">
      <div className="flex justify-between gap-6">
        <div className="min-w-0 flex-1">
          <RawSourceLine source={row.source} createdAt={row.created_at} hasChildren={hasChildren} />
          <RawRowBody preview={row.preview} tags={row.tags} privateFlag={row.flagged_private} media={row.media} />
        </div>
        <RawRowActions row={row} actions={actions} mode={mode} setMode={setMode} />
      </div>
      <RawInlineForms row={row} actions={actions} mode={mode} onDone={() => setMode('view')} />
    </div>
  );
}

function RawInlineForms({
  row, actions, mode, onDone,
}: { row: RawAdminView; actions: CorpusActionsHook; mode: RawMode; onDone: () => void }) {
  const map = {
    view: null,
    promote: <PromoteRow row={row} actions={actions} onDone={onDone} />,
    edit: <EditRow row={row} actions={actions} onDone={onDone} />,
  } as const;
  return map[mode];
}

// RawSourceLine —— vault origin cleaned to a breadcrumb: "obsidian:raw/a/b/c/c.md"
// → "a / b / c" (folder-note dup dropped), on one truncating line. No more long
// uppercase path crammed into an 80px column overlapping the body.
function RawSourceLine({
  source, createdAt, hasChildren,
}: { source: string; createdAt: string; hasChildren: boolean }) {
  return (
    <div className="flex items-baseline gap-2 mono text-[10px] tracking-[0.1em] text-(--color-faint) mb-1 min-w-0">
      <span className="uppercase text-(--color-muted) truncate">{prettySource(source)}</span>
      {hasChildren ? <span className="text-(--color-faint) shrink-0" aria-hidden>{'▾'}</span> : null}
      <span className="shrink-0 tabular-nums normal-case tracking-[0.04em]">{formatRawDate(createdAt)}</span>
    </div>
  );
}

function prettySource(source: string): string {
  const s = source.replace(/^obsidian:(raw|wiki|output)\//i, '').replace(/\.md$/i, '');
  const parts = s.split('/').filter(Boolean);
  return dropFolderNoteDup(parts).join(' / ') || source;
}

// dropFolderNoteDup —— Obsidian folder-notes serialise as "necessity/necessity.md";
// the trailing dup is noise in a breadcrumb, so collapse "a/b/b" → "a/b".
function dropFolderNoteDup(parts: readonly string[]): readonly string[] {
  const isDup = parts.length >= 2 && parts.at(-1) === parts.at(-2);
  return isDup ? parts.slice(0, -1) : parts;
}

function formatRawDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function RawRowBody({
  preview, tags, privateFlag, media,
}: {
  preview?: string; tags: readonly string[];
  privateFlag: boolean; media?: RawAdminView['media'];
}) {
  // The card shows the backend's clean rendered lead (LeadLine) — or nothing. It must NEVER fall
  // back to the raw body: that fallback is what leaked `$$`/```` ``` ````/`[[…]]`/`**…**` into the
  // triage list (F-R-1). An all-structure note (LeadLine "") gets an empty lead, not source markup.
  return (
    <div className="min-w-0">
      <p className="reading-tight text-(--color-ink) text-[15px] line-clamp-3">{preview}</p>
      {media && (
        <div className="mono text-[10px] tracking-[0.06em] text-(--color-faint) mt-1">
          {media.kind} · {media.label}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-1.5">
        {tags.map((t) => <Chip key={t}>{t}</Chip>)}
        <PrivateBadge on={privateFlag} />
      </div>
    </div>
  );
}

function PrivateBadge({ on }: { on: boolean }) {
  const t = useTranslations('adminCorpus.raw');
  return on
    ? <span className="mono text-[10px] tracking-[0.14em] uppercase ml-1 text-(--color-accent)">{t('flaggedPrivateBadge')}</span>
    : null;
}

interface RowActionsProps {
  row: RawAdminView;
  actions: CorpusActionsHook;
  mode: RawMode;
  setMode: (m: RawMode) => void;
}

function RawRowActions(props: RowActionsProps) {
  const t = useTranslations('adminCorpus.raw');
  const toast = useToast();
  // 这个按钮以前写着 archive,打的却是 DELETE,而后端的"归档"没有第二半:没有列表
  // 显示归档的行,也没有恢复的入口。既然做的就是删,名字就得是删 —— 而且确认框要说实话
  // (owner 按 "archive" 时以为还找得回来)。
  const onDelete = () => confirm('Delete this raw entry? This cannot be undone.')
    ? void runWith(
      () => props.actions.deleteRaw(props.row.id),
      () => toast.success('Raw deleted'),
    )
    : null;
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => props.setMode(props.mode === 'promote' ? 'view' : 'promote')}
        data-testid={`raw-promote-${props.row.id}`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) disabled:opacity-40"
      >
        {t('promoteToWiki')}
      </button>
      <button
        type="button"
        onClick={() => props.setMode(props.mode === 'edit' ? 'view' : 'edit')}
        data-testid={`raw-edit-${props.row.id}`}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:opacity-40"
      >
        {t('edit')}
      </button>
      <button
        type="button"
        onClick={onDelete}
        data-testid={`raw-delete-${props.row.id}`}
        className={DANGER_ACTION_CLASS}
      >
        {t('delete')}
      </button>
    </div>
  );
}

interface PromoteRowProps {
  row: RawAdminView;
  actions: CorpusActionsHook;
  onDone: () => void;
}

function PromoteRow(props: PromoteRowProps) {
  const toast = useToast();
  const onSubmit = (input: PromoteInput) => void runWith(
    () => props.actions.promoteRaw(props.row.id, input),
    () => { toast.success('Promoted to wiki'); props.onDone(); },
  );
  return (
    <div className="mt-4 max-w-[560px]">
      <PromoteForm
        busy={props.actions.pending}
        testidPrefix={`raw-promote-form-${props.row.id}`}
        onSubmit={onSubmit}
        onCancel={props.onDone}
      />
    </div>
  );
}

interface EditRowProps {
  row: RawAdminView;
  actions: CorpusActionsHook;
  onDone: () => void;
}

function EditRow(props: EditRowProps) {
  const [body, setBody] = useState(props.row.body);
  const [tagsRaw, setTagsRaw] = useState(props.row.tags.join(', '));
  const [flagged, setFlagged] = useState(props.row.flagged_private);
  // 封面跟正文一起存 —— corpus.update 对 hero 之外的字段是整份替换,单发一个 cover
  // 会把正文清空(跟 wiki/output 那边同一个道理)。
  // hero 三件套从详情拉 —— 列表行不带它们。**不拉的话表单会把已有的值显示成空**,
  // owner 看到一个空的 "cover line" 会以为没设过。
  const heroForm = useRawHeroForm(props.row.id, props.actions);
  const { cover, setCover, coverHeadline, coverHue } = heroForm;
  const toast = useToast();
  const onSave = () => void runWith(
    () => props.actions.updateRaw(props.row.id, {
      body,
      tags: tagsRaw.split(',').map((t) => t.trim()).filter((t) => t !== ''),
      flagged_private: flagged,
      ...heroInput(heroForm),
    }),
    () => { toast.success('Raw updated'); props.onDone(); },
  );
  return (
    <div
      className="mt-4 space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/60 rounded-sm max-w-[640px]"
      data-testid={`raw-edit-form-${props.row.id}`}
    >
      <EditBodyField value={body} onChange={setBody} testid={`raw-edit-body-${props.row.id}`} />
      {/* 素材区 —— raw 也能挂图和附件(assets 表按 holder_id 挂,一直是 genre 无关的)。
          倾倒框那边没有它:那时条目还不存在,没有东西可挂。 */}
      <CorpusAssetsPanel
        genre="raw"
        entryID={props.row.id}
        testidPrefix={`raw-edit-form-${props.row.id}`}
        insertIntoBody={(md) => setBody(appendBlock(body, md))}
        onSetCover={setCover}
        coverAssetID={cover}
      />
      {/* hero 的另外两样 —— 跟 wiki/output 用的是同一个组件,不是这儿手抄一份。 */}
      <HeroFields
        headline={coverHeadline} hue={coverHue}
        onHeadline={heroForm.setCoverHeadline} onHue={heroForm.setCoverHue}
        testid={`raw-edit-form-${props.row.id}`}
      />
      <EditTagsField value={tagsRaw} onChange={setTagsRaw} testid={`raw-edit-tags-${props.row.id}`} />
      <EditPrivateField on={flagged} onChange={setFlagged} testid={`raw-edit-private-${props.row.id}`} />
      <EditActions
        busy={props.actions.pending} canSave={body.trim() !== ''}
        onSave={onSave} onCancel={props.onDone}
        testidPrefix={`raw-edit-form-${props.row.id}`}
      />
    </div>
  );
}

function EditBodyField({
  value, onChange, testid,
}: { value: string; onChange: (v: string) => void; testid: string }) {
  const t = useTranslations('adminCorpus.common');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('body')}
      </span>
      <textarea
        rows={4} value={value} onChange={(e) => onChange(e.target.value)}
        data-testid={testid} spellCheck={false}
        className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[15px]"
      />
    </label>
  );
}

function EditTagsField({
  value, onChange, testid,
}: { value: string; onChange: (v: string) => void; testid: string }) {
  const t = useTranslations('adminCorpus.common');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('tagsLabel')}
      </span>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)}
        data-testid={testid} spellCheck={false}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      />
    </label>
  );
}

function EditPrivateField({
  on, onChange, testid,
}: { on: boolean; onChange: (b: boolean) => void; testid: string }) {
  const t = useTranslations('adminCorpus.raw');
  return (
    <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
      <input
        type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)}
        data-testid={testid}
      />
      <span>{t('flaggedPrivateField')}</span>
    </label>
  );
}

interface EditActionsProps {
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  testidPrefix: string;
}

function EditActions(props: EditActionsProps) {
  const t = useTranslations('adminCorpus.common');
  return (
    <div className="flex items-baseline gap-3 justify-end pt-2">
      <button
        type="button" onClick={props.onCancel} disabled={props.busy}
        className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
      >
        {t('cancel')}
      </button>
      <button
        type="button" onClick={props.onSave} disabled={props.busy || !props.canSave}
        data-testid={`${props.testidPrefix}-submit`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) disabled:opacity-40"
      >
        {props.busy ? t('saving') : t('save')}
      </button>
    </div>
  );
}

