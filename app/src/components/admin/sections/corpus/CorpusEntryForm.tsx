// CorpusEntryForm —— wiki / output 通用的 create / edit 表单。
// 字段：title / body / tags（逗号分隔）。状态机全部在
// lib/admin/use-corpus-form.ts，本文件只做 presentation。
// retrieval-redesign 后 visibility 字段砍掉，access ACL 走 access_codes.corpus_permissions。

'use client';

import { useCorpusForm, type CorpusFormHook } from '@/lib/admin/use-corpus-form';
import type { CorpusEntryInput, PromoteInput } from '@/lib/admin/use-corpus-actions';

// CorpusParentOption —— 「挂在哪个节点下」下拉的一项(某条已有 entry)。
export interface CorpusParentOption {
  id: string;
  label: string;
}

// corpusParentOptions —— rows → parent 候选。label 优先用树地址(path),否则 title。
export function corpusParentOptions(
  rows: readonly { id: string; title: string; path?: string | null }[],
): CorpusParentOption[] {
  return rows.map((r) => ({ id: r.id, label: r.path ?? r.title }));
}

export interface CorpusEntryFormProps {
  initial?: Partial<CorpusEntryInput>;
  busy: boolean;
  onSubmit: (input: CorpusEntryInput) => void;
  onCancel: () => void;
  submitLabel: string;
  testidPrefix: string;
  bodyVisible?: boolean;
  parentOptions?: readonly CorpusParentOption[];
}

export function CorpusEntryForm(props: CorpusEntryFormProps) {
  const form = useCorpusForm(props.initial);
  const bodyVisible = props.bodyVisible !== false;
  return (
    <div
      className="space-y-3 border border-(--color-rule) p-4 bg-(--color-surface)/60 rounded-sm"
      data-testid={`${props.testidPrefix}-form`}
    >
      <TitleField form={form} testid={props.testidPrefix} />
      {bodyVisible ? <BodyField form={form} testid={props.testidPrefix} /> : null}
      <TagsField form={form} testid={props.testidPrefix} />
      {props.parentOptions
        ? <ParentField form={form} testid={props.testidPrefix} options={props.parentOptions} />
        : null}
      <FormActions
        form={form} busy={props.busy} bodyVisible={bodyVisible}
        submitLabel={props.submitLabel} testid={props.testidPrefix}
        onSubmit={() => props.onSubmit(form.toEntryInput(bodyVisible))}
        onCancel={props.onCancel}
      />
    </div>
  );
}

export interface PromoteFormProps {
  busy: boolean;
  onSubmit: (input: PromoteInput) => void;
  onCancel: () => void;
  defaultTitle?: string;
  testidPrefix: string;
}

export function PromoteForm(props: PromoteFormProps) {
  return (
    <CorpusEntryForm
      initial={{ title: props.defaultTitle ?? '', body: '' }}
      busy={props.busy}
      submitLabel="promote"
      testidPrefix={props.testidPrefix}
      bodyVisible={false}
      onSubmit={(input) => props.onSubmit({
        title: input.title, tags: input.tags,
      })}
      onCancel={props.onCancel}
    />
  );
}

// ─── fields ────────────────────────────────────────────────

function TitleField({ form, testid }: { form: CorpusFormHook; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        title
      </span>
      <input
        type="text"
        value={form.title}
        onChange={(e) => form.setTitle(e.target.value)}
        spellCheck={false}
        data-testid={`${testid}-title`}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 reading-tight text-[17px]"
      />
    </label>
  );
}

function BodyField({ form, testid }: { form: CorpusFormHook; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        body
      </span>
      <textarea
        rows={5}
        value={form.body}
        onChange={(e) => form.setBody(e.target.value)}
        spellCheck={false}
        data-testid={`${testid}-body`}
        className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[15px]"
      />
    </label>
  );
}

function TagsField({ form, testid }: { form: CorpusFormHook; testid: string }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        tags (comma-separated)
      </span>
      <input
        type="text"
        value={form.tagsRaw}
        onChange={(e) => form.setTagsRaw(e.target.value)}
        spellCheck={false}
        placeholder="architecture, ai, indie"
        data-testid={`${testid}-tags`}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      />
    </label>
  );
}

function ParentField({
  form, testid, options,
}: { form: CorpusFormHook; testid: string; options: readonly CorpusParentOption[] }) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        parent node (optional)
      </span>
      <select
        value={form.parentID}
        onChange={(e) => form.setParentID(e.target.value)}
        data-testid={`${testid}-parent`}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      >
        <option value="">— none (root) —</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

interface ActionsProps {
  form: CorpusFormHook;
  busy: boolean;
  bodyVisible: boolean;
  submitLabel: string;
  testid: string;
  onSubmit: () => void;
  onCancel: () => void;
}

function FormActions(props: ActionsProps) {
  const disabled = props.form.submitDisabledReason(props.busy, props.bodyVisible);
  return (
    <div className="flex items-baseline gap-3 justify-end pt-2">
      <button
        type="button"
        onClick={props.onCancel}
        disabled={props.busy}
        className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
      >
        cancel
      </button>
      <button
        type="button"
        onClick={props.onSubmit}
        disabled={disabled}
        data-testid={`${props.testid}-submit`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {props.busy ? 'saving…' : props.submitLabel}
      </button>
    </div>
  );
}
