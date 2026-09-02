// CorpusEntryForm —— the create / edit form shared by wiki / output.
// Fields: title / body / tags (comma-separated). The whole state machine lives in
// lib/admin/use-corpus-form.ts; this file is presentation only.
// After the retrieval redesign the visibility field was dropped — access ACL now
// goes through access_codes.corpus_permissions.

'use client';

import type { ReactNode } from 'react';

import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import {
  appendBlock, dropAssetRef, useCorpusForm, type CorpusFormHook,
} from '@/lib/admin/use-corpus-form';
import type { CorpusEntryInput, PromoteInput } from '@/lib/admin/use-corpus-actions';

// CorpusParentOption —— one option in the "attach under which node" dropdown
// (an existing entry).
export interface CorpusParentOption {
  id: string;
  label: string;
}

// corpusParentOptions —— rows → parent candidates. Label prefers the tree address
// (path), falling back to title.
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
  // heading —— which half this card owns. **Pass it only when another card with
  // its own submit sits alongside it** (edit mode: the PUBLIC LANDING card below).
  // The tail end of UX-60: two submit boundaries stacked in one scrolling pane —
  // the card below has a name, this one doesn't, so only one side is legible about
  // "which button do I press". The promote / create paths have only one submit,
  // so giving them a heading would just be structure for its own sake.
  heading?: string;
  bodyVisible?: boolean;
  parentOptions?: readonly CorpusParentOption[];
  // renderAssets —— the assets section. It's a callback rather than a plain
  // ReactNode because "insert into body" needs to mutate body, and body's state
  // lives in this form — handing out a write entry point is safer than letting
  // the assets section keep its own copy of body. On create there's no id yet
  // so no assets can attach, hence this prop is optional: callers pass it only
  // in edit mode.
  renderAssets?: (api: CorpusFormAssetsAPI) => ReactNode;
}

// CorpusFormAssetsAPI —— what the assets section can do to this form.
//
// The cover goes through the form rather than firing its own request:
// corpus.update **fully replaces** every field other than hero, so sending just
// a cover_image_asset_id would wipe out title and body along with it. So this
// only mutates form state, and it gets submitted together with the body when
// the owner clicks save.
export interface CorpusFormAssetsAPI {
  insertIntoBody: (markdown: string) => void;
  // dropFromBody —— when an asset is dropped, also remove the image referencing
  // it from the body (F-L-50).
  dropFromBody: (assetID: string) => void;
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
      {props.heading ? (
        <h4 className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
          {props.heading}
        </h4>
      ) : null}
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

// BodySlot —— the body field plus the assets section right after it. The two are
// bound together: the assets section's "insert into body" needs to write body,
// and the promote path has no body at all, so there's nowhere for assets to
// attach there either.
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
    // dropFromBody —— the other half of insertIntoBody (F-L-50). When an asset
    // is dropped, the reference to it in the body must go too: otherwise it's
    // left behind as a broken image + internal filename on the visitor page,
    // while the owner's panel shows nothing unusual. Body state lives here, so
    // the cleanup belongs here too.
    dropFromBody: (assetID) => { form.setBody(dropAssetRef(form.body, assetID)); },
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

// HeroFields —— the other two hero fields. The image is picked in the assets
// section (that's the only place you can see what images exist) —
// **this headline text and this hue must sit next to it** — doing only the
// image would leave the owner, after setting a cover, seeing the title bumped
// up to serve as headline with no way to change it. The visitor side renders
// all three.
//
// Exported for raw's use: raw's inline edit form doesn't go through
// CorpusEntryForm (it has no title, its fields differ), but hero is the same
// concern there — hand-copying it there would eventually let the two drift
// apart. Hence the params are narrowed to these four values instead of the
// whole form hook.
// COVER_HUES —— the three literals the backend recognizes (entity/cover.go).
// **Do not translate** — these are values stored in the database, not
// user-facing copy; translating them would break round-tripping to storage.
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
          className="sm-field-input"
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
        className="sm-field-input sm-field-lg"
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
      {/* The whole point of this corpus is long-form notes, yet this box used to be
          one of the smallest on the screen (5 rows, ~120px) while FILES / COVER LINE /
          HUE / TAGS / META DESCRIPTION ran all the way down — the proportions were
          backwards (UX-61). Give the body enough rows and let the owner resize it
          themselves: whoever is writing long-form knows how big they need it. */}
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
        className="sm-field-input sm-mono"
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

// CitableField —— show_as_source (whether the AI lists this as a source under
// its answer, after having read it).
//
// Copy lives in i18n/messages/en.json under corpus.citable.*. That help text
// isn't decoration: being read (whether it enters the AI's context, decided by
// the role/code's corpus URI) and being cited (whether it's listed as a source
// under the answer, i.e. this checkbox) are **not the same thing**. Without
// spelling that out, the owner faces a checkbox with no context and can only
// guess wrong.
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
