// NewTokenInline — type a name, pick what the key may do, click create. Keeps the e2e testids
// (token-name / token-scope / token-create).

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SelectField } from '@/components/atoms/SelectField';
import { keyScopePresetOf, type KeyScopePreset } from '@/lib/admin/use-tokens';
import { useReportError } from '@/lib/ui/use-report-error';

type CreateToken = (name: string, preset?: KeyScopePreset) => Promise<void>;

type Props = {
  createToken: CreateToken;
  error: string | null;
};

export function NewTokenInline({ createToken, error }: Props) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<KeyScopePreset>('full');
  const report = useReportError();
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    trimmed === '' || await submit(() => createToken(trimmed, preset), setName, report);
  }, [name, preset, createToken, report]);
  return (
    <form onSubmit={onSubmit} className="space-y-3 mb-4">
      <NameField name={name} onChange={setName} />
      <ScopeField preset={preset} onChange={setPreset} />
      <ErrorBox message={error} />
      <SubmitBtn />
    </form>
  );
}

// submit — on success, reveal the private key + clear the label; on
// failure, report and **keep the label** (don't drop what owner just typed,
// so a retry is a straight click).
async function submit(
  create: () => Promise<void>,
  setName: (v: string) => void,
  report: (e: unknown) => void,
): Promise<void> {
  try {
    await create();
    setName('');
  } catch (e) {
    report(e);
  }
}

function NameField({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminIntegrations.newToken');
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('label')}
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('namePlaceholder')}
        data-testid="token-name"
        className="sm-field-input"
      />
    </label>
  );
}

const PRESETS: readonly KeyScopePreset[] = ['full', 'read', 'content'];
const PRESET_LABEL = { full: 'scopeFull', read: 'scopeRead', content: 'scopeContent' } as const;

function ScopeField(
  { preset, onChange }: { preset: KeyScopePreset; onChange: (p: KeyScopePreset) => void },
) {
  const t = useTranslations('adminIntegrations.newToken');
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('scope')}
      </div>
      <SelectField
        value={preset}
        onChange={(e) => onChange(keyScopePresetOf(e.target.value))}
        testid="token-scope"
      >
        {PRESETS.map((p) => (
          <option key={p} value={p}>{t(PRESET_LABEL[p])}</option>
        ))}
      </SelectField>
    </label>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  return message ? <p className="mono text-xs text-(--color-accent)">{message}</p> : null;
}

function SubmitBtn() {
  const t = useTranslations('adminIntegrations.newToken');
  return (
    <button
      type="submit"
      data-testid="token-create"
      className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5"
    >
      {t('submit')}
    </button>
  );
}
