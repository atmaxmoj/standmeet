// EmbedCreateModal — one modal for both "new embed" and "edit embed".
//
// create: pick a code + label + allowed origins + update hook URL → POST /embeds.
// edit: the code is locked (swapping it would make **another** embed — the tag
//   pasted on the outside site still points at the old code) — only label,
//   allowed origins and the update hook URL are editable, matching what the
//   backend update op accepts.
//
// Form state / save dispatch / copy all live in use-embeds (lib): the presentation
// layer must have no `if`, branch count capped at 3.

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { SelectField } from '@/components/atoms/SelectField';
import { ModalShell } from '@/components/admin/modals/ModalShell';
import type { CodeView } from '@/lib/admin/use-codes';
import {
  dispatchEmbedSave, embedModalText, useEmbedForm,
  type EmbedFormHook, type EmbedFormValues, type EmbedView, type SyncMode,
} from '@/lib/admin/use-embeds';

type OnCreate = (codeID: string, values: EmbedFormValues) => Promise<void>;
type OnUpdate = (id: string, values: EmbedFormValues) => Promise<void>;

type Props = {
  existing: EmbedView | null;
  codes: readonly CodeView[];
  onClose: () => void;
  onCreate: OnCreate;
  onUpdate: OnUpdate;
};

export function EmbedCreateModal({ existing, codes, onClose, onCreate, onUpdate }: Props) {
  const t = useTranslations('adminAccess.embeds.form');
  const form = useEmbedForm(existing);
  const text = embedModalText(t, form.editing);
  const submit = useSubmit(existing, form, onCreate, onUpdate);
  return (
    <ModalShell onClose={onClose} kicker={text.kicker} title={text.title} maxWidth={620}>
      <form data-testid="embed-form" onSubmit={submit} className="px-7 py-6 space-y-7">
        <CodePicker form={form} codes={codes} />
        <LabelField form={form} />
        <OriginsField form={form} />
        <SyncModeField form={form} />
        {form.syncMode === 'copy' && <HookField form={form} />}
        <Footer save={text.save} disabled={form.codeID === ''} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function useSubmit(
  existing: EmbedView | null,
  form: EmbedFormHook,
  onCreate: OnCreate,
  onUpdate: OnUpdate,
) {
  return useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await dispatchEmbedSave(existing, form, onCreate, onUpdate);
  }, [existing, form, onCreate, onUpdate]);
}

function CodePicker({ form, codes }: { form: EmbedFormHook; codes: readonly CodeView[] }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <label className="block space-y-2">
      <FieldKicker text={t('codeField')} />
      {/* Code is locked while editing: swapping it = another embed, the tag pasted
          on the outside site still points at the old code. */}
      <SelectField
        className="w-full" value={form.codeID} testid="embed-code"
        onChange={(e) => form.setCodeID(e.target.value)} disabled={form.editing}
      >
        <option value="">{t('codePlaceholder')}</option>
        {codes.map((c) => (
          <option key={c.id} value={c.id}>{c.code} — {c.label}</option>
        ))}
      </SelectField>
    </label>
  );
}

function LabelField({ form }: { form: EmbedFormHook }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <label className="block space-y-2">
      <FieldKicker text={t('labelField')} />
      <input
        type="text" data-testid="embed-label" value={form.label}
        onChange={(e) => form.setLabel(e.target.value)}
        placeholder={t('labelPlaceholder')} className="sm-field-input"
      />
    </label>
  );
}

function OriginsField({ form }: { form: EmbedFormHook }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <label className="block space-y-2">
      <FieldKicker text={t('originsField')} />
      <textarea
        data-testid="embed-origins" value={form.origins} rows={3}
        onChange={(e) => form.setOrigins(e.target.value)}
        placeholder={t('originsPlaceholder')}
        className="sm-field-input font-mono text-[12px] resize-y"
      />
      <p className="mono text-[9.5px] text-(--color-faint) leading-relaxed">{t('originsHelp')}</p>
    </label>
  );
}

const SYNC_MODES: readonly SyncMode[] = ['live', 'copy'];

// SyncModeField —— how the site behind the embed keeps up with the corpus: live (it reads per
// request) or copy (it keeps a copy, and the update hook below tells it what changed).
function SyncModeField({ form }: { form: EmbedFormHook }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2"><FieldKicker text={t('syncModeField')} /></legend>
      {SYNC_MODES.map((m) => (
        <label key={m} className="flex items-baseline gap-3 text-[13.5px] reading-tight">
          <input
            type="radio" name="embed-sync-mode" value={m} data-testid={`embed-sync-mode-${m}`}
            checked={form.syncMode === m} onChange={() => form.setSyncMode(m)}
          />
          <span className="mono text-[12px] text-(--color-ink)">{t(`syncMode.${m}`)}</span>
          <span className="text-(--color-muted)">{t(`syncModeHelp.${m}`)}</span>
        </label>
      ))}
    </fieldset>
  );
}

// HookField —— the Update hook URL (copy mode only): the site that keeps a copy of this embed's
// corpus gets a signed event on every change inside the embed's code scope.
function HookField({ form }: { form: EmbedFormHook }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <label className="block space-y-2">
      <FieldKicker text={t('hookField')} />
      <input
        type="url" data-testid="embed-update-hook-url" value={form.hookURL}
        onChange={(e) => form.setHookURL(e.target.value)}
        placeholder={t('hookPlaceholder')} className="sm-field-input font-mono text-[12px]"
      />
      <p className="mono text-[9.5px] text-(--color-faint) leading-relaxed">{t('hookHelp')}</p>
    </label>
  );
}

function FieldKicker({ text }: { text: string }) {
  return (
    <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-ink)">{text}</span>
  );
}

function Footer({
  save, disabled, onClose,
}: { save: string; disabled: boolean; onClose: () => void }) {
  const t = useTranslations('adminAccess.embeds.form');
  return (
    <div className="flex items-center justify-end gap-3 border-t border-(--color-rule) pt-4">
      <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
      <button
        type="submit" data-testid="embed-save" disabled={disabled}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {save}
      </button>
    </div>
  );
}
