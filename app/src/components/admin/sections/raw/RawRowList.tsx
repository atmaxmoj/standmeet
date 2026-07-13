// RawRowList —— Raw section 列表。空时显示 "no raw entries yet" 提示。
// row actions: promote → wiki / archive，都已接 backend PATCH/DELETE/POST 端点。

'use client';

import { useState } from 'react';

import { Chip } from '@/components/admin/atoms/Chip';
import { CorpusViewToggle } from '@/components/admin/atoms/CorpusViewToggle';
import { CorpusTreeGrid } from '@/components/admin/sections/corpus/CorpusTreeGrid';
import { PromoteForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
import { useCorpusView } from '@/lib/admin/corpus-view';
import { cleanCorpusExcerpt } from '@/lib/admin/corpus-tree';
import {
  useCorpusActions,
  type CorpusActionsHook,
  type PromoteInput,
} from '@/lib/admin/use-corpus-actions';
import { runWith } from '@/lib/admin/use-corpus-form';
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
        renderCard={(row, { hasChildren }) => (
          <RawRow row={row} actions={actions} hasChildren={hasChildren} />
        )}
      />
    </>
  );
}

function EmptyState() {
  return (
    <div data-testid="raw-list" className="border-t border-(--color-rule)/70">
      <p className="py-8 reading italic text-(--color-muted) text-center">
        No raw entries yet. Push one from an MCP client (raw_dump tool).
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
          <RawRowBody body={row.body} tags={row.tags} privateFlag={row.flagged_private} media={row.media} />
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
      {hasChildren ? <span className="text-(--color-faint) shrink-0" aria-hidden>▾</span> : null}
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
  body, tags, privateFlag, media,
}: { body: string; tags: readonly string[]; privateFlag: boolean; media?: RawAdminView['media'] }) {
  return (
    <div className="min-w-0">
      <p className="reading-tight text-(--color-ink) text-[15px] line-clamp-3">{cleanCorpusExcerpt(body)}</p>
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
  return on
    ? <span className="mono text-[10px] tracking-[0.14em] uppercase ml-1 text-(--color-accent)">· flagged private</span>
    : null;
}

interface RowActionsProps {
  row: RawAdminView;
  actions: CorpusActionsHook;
  mode: RawMode;
  setMode: (m: RawMode) => void;
}

function RawRowActions(props: RowActionsProps) {
  const toast = useToast();
  const onArchive = () => confirm('Archive this raw entry?')
    ? void runWith(
      () => props.actions.archiveRaw(props.row.id),
      () => toast.success('Raw archived'),
    )
    : null;
  return (
    <div className="flex flex-col items-end gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => props.setMode(props.mode === 'promote' ? 'view' : 'promote')}
        disabled={props.row.archived}
        data-testid={`raw-promote-${props.row.id}`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) disabled:opacity-40"
      >
        promote → wiki ↗
      </button>
      <button
        type="button"
        onClick={() => props.setMode(props.mode === 'edit' ? 'view' : 'edit')}
        disabled={props.row.archived}
        data-testid={`raw-edit-${props.row.id}`}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:opacity-40"
      >
        edit
      </button>
      <button
        type="button"
        onClick={onArchive}
        disabled={props.row.archived}
        data-testid={`raw-archive-${props.row.id}`}
        className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent) disabled:opacity-40"
      >
        {props.row.archived ? 'archived' : 'archive'}
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
  const toast = useToast();
  const onSave = () => void runWith(
    () => props.actions.updateRaw(props.row.id, {
      body,
      tags: tagsRaw.split(',').map((t) => t.trim()).filter((t) => t !== ''),
      flagged_private: flagged,
    }),
    () => { toast.success('Raw updated'); props.onDone(); },
  );
  return (
    <div
      className="mt-4 space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/60 rounded-sm max-w-[640px]"
      data-testid={`raw-edit-form-${props.row.id}`}
    >
      <EditBodyField value={body} onChange={setBody} testid={`raw-edit-body-${props.row.id}`} />
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
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        body
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
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        tags (comma-separated)
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
  return (
    <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
      <input
        type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)}
        data-testid={testid}
      />
      <span>flagged private (excluded from public chat)</span>
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
  return (
    <div className="flex items-baseline gap-3 justify-end pt-2">
      <button
        type="button" onClick={props.onCancel} disabled={props.busy}
        className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
      >
        cancel
      </button>
      <button
        type="button" onClick={props.onSave} disabled={props.busy || !props.canSave}
        data-testid={`${props.testidPrefix}-submit`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) disabled:opacity-40"
      >
        {props.busy ? 'saving…' : 'save'}
      </button>
    </div>
  );
}

