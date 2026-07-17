// CorpusEntryForm —— wiki / output 通用的 create / edit 表单。
// 字段：title / body / tags（逗号分隔）。状态机全部在
// lib/admin/use-corpus-form.ts，本文件只做 presentation。
// retrieval-redesign 后 visibility 字段砍掉，access ACL 走 access_codes.corpus_permissions。

'use client';

import { useTranslations } from 'next-intl';

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
      <CitableField form={form} testid={props.testidPrefix} />
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
  const t = useTranslations('adminCorpus.form');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('title')}
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
  const t = useTranslations('adminCorpus.common');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('body')}
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
  const t = useTranslations('adminCorpus.common');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('tagsLabel')}
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
  const t = useTranslations('adminCorpus');
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {t('form.parent')}
      </span>
      <select
        value={form.parentID}
        onChange={(e) => form.setParentID(e.target.value)}
        data-testid={`${testid}-parent`}
        className="w-full bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
      >
        <option value="">{t('common.noneRoot')}</option>
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
  const t = useTranslations('adminCorpus.common');
  const disabled = props.form.submitDisabledReason(props.busy, props.bodyVisible);
  return (
    <div className="flex items-baseline gap-3 justify-end pt-2">
      <button
        type="button"
        onClick={props.onCancel}
        disabled={props.busy}
        className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent) disabled:opacity-50"
      >
        {t('cancel')}
      </button>
      <button
        type="button"
        onClick={props.onSubmit}
        disabled={disabled}
        data-testid={`${props.testid}-submit`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {props.busy ? t('saving') : props.submitLabel}
      </button>
    </div>
  );
}

// CitableField —— show_as_source（AI 读了之后，答案里列不列出处）。
//
// 文案在 i18n/messages/en.json 的 corpus.citable.*。那段 help 不是装饰：读到（能不能进 AI 的
// 上下文，由 role/code 的 corpus URI 决定）和引用（答案下面列不列出处，就是这个勾）**不是一回事**，
// 不讲明白，owner 面对的就是一个没有语境的勾，只会猜错。
function CitableField({ form, testid }: { form: CorpusFormHook; testid: string }) {
  const t = useTranslations('adminCorpus.citable');
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-baseline gap-2 mono text-[10.5px] tracking-[0.06em]">
        <input
          type="checkbox"
          checked={form.citable}
          onChange={(e) => form.setCitable(e.target.checked)}
          data-testid={`${testid}-citable`}
        />
        <span>{t('label')}</span>
      </label>
      <p className="reading-tight text-[11px] text-(--color-muted) pl-5">{t('help')}</p>
    </div>
  );
}
