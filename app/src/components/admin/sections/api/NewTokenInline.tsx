// NewTokenInline —— 输入 name 后点 create。保留 e2e testid（token-name / token-create）。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useReportError } from '@/lib/ui/use-report-error';

type Props = {
  createToken: (name: string) => Promise<void>;
  error: string | null;
};

export function NewTokenInline({ createToken, error }: Props) {
  const [name, setName] = useState('');
  const report = useReportError();
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    trimmed === '' || await submit(trimmed, createToken, setName, report);
  }, [name, createToken, report]);
  return (
    <form onSubmit={onSubmit} className="space-y-3 mb-4">
      <NameField name={name} onChange={setName} />
      <ErrorBox message={error} />
      <SubmitBtn />
    </form>
  );
}

// submit —— 成功 reveal 私钥 + 清空 label；失败 report 且**保留 label**（别丢 owner 刚填的输入，可直接重试）。
async function submit(
  trimmed: string,
  createToken: (n: string) => Promise<void>,
  setName: (v: string) => void,
  report: (e: unknown) => void,
): Promise<void> {
  try {
    await createToken(trimmed);
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
        placeholder="device label — e.g. 'mojat-mbp'"
        data-testid="token-name"
        className="sm-field-input"
      />
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
