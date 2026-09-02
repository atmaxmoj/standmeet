// RawDumpBox — the "quick dump" entry point. Owner can paste a thought directly in admin.
// POST /api/admin/corpus/raw is wired: onAdd goes through useRaw().addRaw,
// textarea clears on success.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { Chip } from '@/components/admin/atoms/Chip';
import type { CreateRawInput } from '@/lib/api/admin';

const SOURCE_OPTIONS = ['claude', 'cursor', 'chatgpt', 'upload', 'obsidian', 'mcp'] as const;
type SourceOption = typeof SOURCE_OPTIONS[number];

type Props = {
  submitting: boolean;
  submitError: string | null;
  onAdd: (input: CreateRawInput) => Promise<boolean>;
};

export function RawDumpBox({ submitting, submitError, onAdd }: Props) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<SourceOption>('claude');
  const handleAdd = useCallback(async () => {
    const trimmed = text.trim();
    const ok = trimmed !== '' && await onAdd({ body: trimmed, source });
    ok && setText('');
  }, [text, onAdd, source]);
  return (
    <div className="border border-dashed border-(--color-rule) bg-(--color-surface)/40 rounded-sm p-4 relative">
      <RawDumpHead />
      <SourcePicker active={source} onPick={setSource} />
      <RawDumpTextarea value={text} onChange={setText} />
      <RawDumpFooter
        disabled={text.trim() === '' || submitting}
        submitting={submitting}
        error={submitError}
        onAdd={() => { void handleAdd(); }}
      />
    </div>
  );
}

function SourcePicker({ active, onPick }: { active: SourceOption; onPick: (s: SourceOption) => void }) {
  return (
    <div className="flex items-baseline gap-1.5 flex-wrap mb-3">
      {SOURCE_OPTIONS.map((s) => (
        <Chip key={s} active={active === s} onClick={() => onPick(s)}>{s}</Chip>
      ))}
    </div>
  );
}

function RawDumpHead() {
  const t = useTranslations('adminCorpus.raw');
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) flex items-baseline gap-2">
        <span>{t('quickDump')}</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-faint)">{t('dumpHint')}</span>
      </div>
      <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-faint)">
        {t('dumpOrigin')}
      </span>
    </div>
  );
}

function RawDumpTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Paste a thought, a passage from a chat, a half-formed take."
      rows={3}
      data-testid="dump-input"
      className="w-full bg-transparent text-(--color-ink) placeholder:text-(--color-faint) reading-tight text-[15.5px]"
    />
  );
}

type FooterProps = {
  disabled: boolean;
  submitting: boolean;
  error: string | null;
  onAdd: () => void;
};

function RawDumpFooter({ disabled, submitting, error, onAdd }: FooterProps) {
  const t = useTranslations('adminCorpus.raw');
  return (
    <div className="flex items-center justify-between mt-3 gap-3">
      <FooterHint error={error} />
      {/* There used to be a span here reading "attach media": cursor-pointer, hover color
          change, no onClick. It couldn't be real — the dump box has no entry id yet, so
          there's nothing to attach to. Attaching files happens in the edit form after the
          entry exists (CorpusAssetsPanel). A label dressed up as a button is worse than none:
          the owner clicks it and assumes the attach happened. */}
      <div className="flex items-baseline gap-3">
        <Btn kind="solid" onClick={onAdd} disabled={disabled}>
          {submitting ? t('dumping') : t('dump')}
        </Btn>
      </div>
    </div>
  );
}

function FooterHint({ error }: { error: string | null }) {
  const t = useTranslations('adminCorpus.raw');
  return error
    ? <span className="mono text-[10px] text-(--color-accent) tracking-[0.06em]">{error}</span>
    : <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {t('unindexedHint')}
      </span>;
}
