// EmbedCreateModal —— "new embed" + "edit embed" 同一个 modal。
//
// create：挑一张码 + label + 白名单来源 → POST /embeds。
// edit：码不让改（换码就是**另一个** embed，外面站点上贴的标签还指着老码）——
//   只改 label + 白名单，对上后端 update op 只收这两样。
//
// 表单状态 / 存档分派 / 文案都在 use-embeds（lib）：呈现层不许有 `if`、分支上限 3。

'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { SelectField } from '@/components/atoms/SelectField';
import { ModalShell } from '@/components/admin/modals/ModalShell';
import type { CodeView } from '@/lib/admin/use-codes';
import {
  dispatchEmbedSave, embedModalText, useEmbedForm,
  type EmbedFormHook, type EmbedView,
} from '@/lib/admin/use-embeds';

type Props = {
  existing: EmbedView | null;
  codes: readonly CodeView[];
  onClose: () => void;
  onCreate: (codeID: string, label: string, origins: string[]) => Promise<void>;
  onUpdate: (id: string, label: string, origins: string[]) => Promise<void>;
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
        <Footer save={text.save} disabled={form.codeID === ''} onClose={onClose} />
      </form>
    </ModalShell>
  );
}

function useSubmit(
  existing: EmbedView | null,
  form: EmbedFormHook,
  onCreate: (codeID: string, label: string, origins: string[]) => Promise<void>,
  onUpdate: (id: string, label: string, origins: string[]) => Promise<void>,
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
      {/* 编辑时码锁死：换码 = 另一个 embed，外面贴的标签还指着老码。 */}
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
