// CorpusEntryForm —— wiki / output 通用的 create / edit 表单。
// 字段：title / body / tags（逗号分隔）。状态机全部在
// lib/admin/use-corpus-form.ts，本文件只做 presentation。
// retrieval-redesign 后 visibility 字段砍掉，access ACL 走 access_codes.corpus_permissions。

'use client';

import type { ReactNode } from 'react';

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { appendBlock, useCorpusForm, type CorpusFormHook } from '@/lib/admin/use-corpus-form';
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
  // renderAssets —— 素材区。写成回调而不是一个 ReactNode,是因为"插进正文"要改 body,
  // 而 body 的状态在这个表单里 —— 把写入口递出去,比让素材区自己拿一份 body 的副本安全。
  // 新建时没有 id,挂不了素材,所以这个 prop 是可选的:调用方只在编辑态传。
  renderAssets?: (api: CorpusFormAssetsAPI) => ReactNode;
}

// CorpusFormAssetsAPI —— 素材区能对这张表单做的事。
//
// 封面走表单而不是单发一个请求:corpus.update 对 hero 之外的字段是**整份替换**,
// 只发一个 cover_image_asset_id 会把标题和正文一起清空。所以这里只改表单状态,
// owner 点 save 时跟正文一起提交。
export interface CorpusFormAssetsAPI {
  insertIntoBody: (markdown: string) => void;
  setCover: (assetID: string) => void;
  coverAssetID: string;
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
      <BodySlot
        form={form} testid={props.testidPrefix}
        visible={bodyVisible} renderAssets={props.renderAssets}
      />
      <TagsField form={form} testid={props.testidPrefix} />
      <CitableField form={form} testid={props.testidPrefix} />
      <ParentSlot form={form} testid={props.testidPrefix} options={props.parentOptions} />
      <FormActions
        form={form} busy={props.busy} bodyVisible={bodyVisible}
        submitLabel={props.submitLabel} testid={props.testidPrefix}
        onSubmit={() => props.onSubmit(form.toEntryInput(bodyVisible))}
        onCancel={props.onCancel}
      />
    </div>
  );
}

// BodySlot —— 正文 + 紧跟着的素材区。两者绑在一起:素材区的"插进正文"要写 body,
// 而 promote 那条路根本没有正文,也就没有可挂素材的地方。
function BodySlot(
  { form, testid, visible, renderAssets }: {
    form: CorpusFormHook;
    testid: string;
    visible: boolean;
    renderAssets?: (api: CorpusFormAssetsAPI) => ReactNode;
  },
) {
  const api: CorpusFormAssetsAPI = {
    insertIntoBody: (markdown) => { form.setBody(appendBlock(form.body, markdown)); },
    setCover: (assetID) => { form.setCoverAssetID(assetID); },
    coverAssetID: form.coverAssetID,
  };
  return visible ? (
    <>
      <BodyField form={form} testid={testid} />
      {renderAssets ? renderAssets(api) : null}
      <HeroFields
        headline={form.coverHeadline} hue={form.coverHue}
        onHeadline={form.setCoverHeadline} onHue={form.setCoverHue}
        testid={testid}
      />
    </>
  ) : null;
}

// HeroFields —— hero 的另外两样。图在素材区里选(那儿才看得见有哪些图),
// **这句话和这个色调必须在旁边** —— 只做图那一样的话,owner 设完封面看到的是标题被
// 顶上去当 headline,而他没有任何办法改它。访客那侧三样都渲。
//
// 导出是给 raw 用的:raw 的行内编辑表单不走 CorpusEntryForm(它没有 title,字段也不同),
// 但 hero 是同一件事 —— 在那边手抄一份的话,两处迟早长得不一样。
// 所以入参收窄成这四个值,而不是整个表单 hook。
// COVER_HUES —— 后端认的三个字面量(entity/cover.go)。**不翻译** —— 它们是存进
// 数据库的值,不是给人看的文案;翻了就存不回去。
const COVER_HUES = ['amber', 'violet', 'acid'] as const;

export interface HeroFieldsProps {
  headline: string;
  hue: string;
  onHeadline: (v: string) => void;
  onHue: (v: string) => void;
  testid: string;
}

export function HeroFields(
  { headline, hue, onHeadline, onHue, testid }: HeroFieldsProps,
) {
  const t = useTranslations('adminCorpus.hero');
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
      <label className="block">
        <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
          {t('headline')}
        </span>
        <input
          type="text"
          value={headline}
          onChange={(e) => onHeadline(e.target.value)}
          spellCheck={false}
          placeholder={t('headlinePlaceholder')}
          data-testid={`${testid}-cover-headline`}
          className="w-full bg-transparent border-b border-(--color-rule) py-1.5 reading-tight text-[15px]"
        />
      </label>
      <label className="block">
        <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
          {t('hue')}
        </span>
        <SelectField
          value={hue}
          onChange={(e) => onHue(e.target.value)}
          testid={`${testid}-cover-hue`}
          mono
        >
          <option value="">{t('hueDefault')}</option>
          {COVER_HUES.map((h) => <option key={h} value={h}>{h}</option>)}
        </SelectField>
      </label>
    </div>
  );
}

function ParentSlot(
  { form, testid, options }: {
    form: CorpusFormHook;
    testid: string;
    options?: readonly CorpusParentOption[];
  },
) {
  return options ? <ParentField form={form} testid={testid} options={options} /> : null;
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
      {/* 这个语料库的全部意义是长文笔记，而这一格曾是整屏最小的框之一（5 行，约 120px），
          下面的 FILES / COVER LINE / HUE / TAGS / META DESCRIPTION 一路铺到底 —— 比例反了
          （UX-61）。给正文足够的行数，并允许 owner 自己拉大：写长文的人自己知道要多大。 */}
      <textarea
        rows={16}
        value={form.body}
        onChange={(e) => form.setBody(e.target.value)}
        spellCheck={false}
        data-testid={`${testid}-body`}
        className="w-full bg-transparent border border-(--color-rule) p-2 reading-tight text-[15px] resize-y min-h-[8rem]"
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
      <SelectField
        value={form.parentID}
        onChange={(e) => form.setParentID(e.target.value)}
        testid={`${testid}-parent`}
        className="w-full"
        mono
      >
        <option value="">{t('common.noneRoot')}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </SelectField>
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
