// WritingFormAtoms —— small widgets shared by the admin writings Create / Edit forms.
// Pure presentational + each carries its own data-testid for e2e.

'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SelectField } from '@/components/atoms/SelectField';
import { WritingEditor } from '@/components/writings/editor';
import type { PendingFile } from '@/lib/writings/upload-asset';

export function WritingFieldRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

export function WritingField({
  label, value, onChange, placeholder, readOnly,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px] disabled:opacity-60"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`writing-field-${label.replace(/ /g, '-')}`}
      />
    </label>
  );
}

export type CoverHue = 'amber' | 'violet' | 'acid';
const COVER_HUES: readonly CoverHue[] = ['amber', 'violet', 'acid'];
function toCoverHue(s: string): CoverHue { return COVER_HUES.find((h) => h === s) ?? 'amber'; }

export function CoverHueSelect({
  value, onChange,
}: { value: CoverHue; onChange: (v: CoverHue) => void }) {
  const t = useTranslations('adminCorpus.writings');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{t('coverHue')}</span>
      <SelectField
        value={value}
        onChange={(e) => onChange(toCoverHue(e.target.value))}
        testid="writing-field-cover-hue"
      >
        <option value="amber">{t('hueAmber')}</option>
        <option value="violet">{t('hueViolet')}</option>
        <option value="acid">{t('hueAcid')}</option>
      </SelectField>
    </label>
  );
}

// ParentSelect —— the "set parent" dropdown: attaches this writing under another
// one in the reader tree. "— none —" = root.
// Options come from the caller (other writings); cycles (attaching under one's
// own descendant) are blocked with a 400 by the backend's reparent validation.
export function ParentSelect({
  value, options, onChange,
}: { value: string; options: { id: string; title: string }[]; onChange: (v: string) => void }) {
  const t = useTranslations('adminCorpus');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('writings.parent')}
      </span>
      <SelectField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        testid="writing-field-parent"
      >
        <option value="">{t('common.noneRoot')}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </SelectField>
    </label>
  );
}

export function WritingBodyField({
  value, onChange, assetURLs, onPending,
}: {
  value: string;
  onChange: (v: string) => void;
  assetURLs?: Record<string, string>;
  onPending?: (p: PendingFile) => void;
}) {
  const t = useTranslations('adminCorpus.common');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('body')}
      </span>
      <WritingEditor value={value} onChange={onChange}
        assetURLs={assetURLs} onPending={onPending} />
    </label>
  );
}

export function WritingFormFooter({
  submitLabel, submitTestId, footerLeft, onClose, onSubmit,
}: {
  submitLabel: string;
  submitTestId: string;
  footerLeft?: ReactNode;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations('adminCorpus.common');
  return (
    <div className="flex justify-between items-baseline mt-2">
      <div>{footerLeft}</div>
      <div className="flex gap-3">
        <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
        <button
          type="button"
          data-testid={submitTestId}
          onClick={onSubmit}
          className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

export function PublishToggle({
  publish, onTogglePublish,
}: { publish: boolean; onTogglePublish: () => void }) {
  const t = useTranslations('adminCorpus.writings');
  return (
    <label className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-2">
      <input
        type="checkbox"
        checked={publish}
        onChange={onTogglePublish}
        data-testid="writing-field-publish"
      />
      {t('publishImmediately')}
    </label>
  );
}
