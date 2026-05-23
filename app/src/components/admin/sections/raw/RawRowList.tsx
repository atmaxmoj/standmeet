// RawRowList —— Raw section 列表。空时显示 "no raw entries yet" 提示。
// row actions: promote → wiki / archive，都已接 backend PATCH/DELETE/POST 端点。

'use client';

import { useState } from 'react';

import { Chip } from '@/components/admin/atoms/Chip';
import { PromoteForm } from '@/components/admin/sections/corpus/CorpusEntryForm';
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
  useEffectErrorToast(actions.error);
  return rows.length === 0
    ? <EmptyState />
    : (
      <ul data-testid="raw-list" className="border-t border-(--color-rule)/70">
        {rows.map((r) => <RawRow key={r.id} row={r} actions={actions} />)}
      </ul>
    );
}

function EmptyState() {
  return (
    <ul data-testid="raw-list" className="border-t border-(--color-rule)/70">
      <li className="py-8 reading italic text-(--color-muted) text-center">
        No raw entries yet. Push one from an MCP client (raw_dump tool).
      </li>
    </ul>
  );
}

type RawMode = 'view' | 'edit' | 'promote';

function RawRow({ row, actions }: { row: RawAdminView; actions: CorpusActionsHook }) {
  const [mode, setMode] = useState<RawMode>('view');
  return (
    <li
      className="border-b border-(--color-rule)/70 py-5"
      data-testid={`raw-row-${row.id}`}
    >
      <div className="grid grid-cols-[80px_1fr_auto] gap-6">
        <RawRowMeta source={row.source} createdAt={row.created_at} />
        <RawRowBody body={row.body} tags={row.tags} privateFlag={row.flagged_private} />
        <RawRowActions row={row} actions={actions} mode={mode} setMode={setMode} />
      </div>
      {mode === 'promote' ? (
        <PromoteRow row={row} actions={actions} onDone={() => setMode('view')} />
      ) : null}
      {mode === 'edit' ? (
        <EditRow row={row} actions={actions} onDone={() => setMode('view')} />
      ) : null}
    </li>
  );
}

function RawRowMeta({ source, createdAt }: { source: string; createdAt: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) pt-1 leading-[1.5]">
      <div className="text-(--color-ink)">{source}</div>
      <div className="text-(--color-faint) mt-0.5 normal-case tracking-[0.04em]">{createdAt}</div>
    </div>
  );
}

function RawRowBody({
  body, tags, privateFlag,
}: { body: string; tags: readonly string[]; privateFlag: boolean }) {
  return (
    <div className="min-w-0">
      <p className="reading-tight text-(--color-ink) text-[15.5px]">{body}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-1.5">
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

