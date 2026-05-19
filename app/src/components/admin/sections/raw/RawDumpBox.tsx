// RawDumpBox —— "quick dump" 入口。owner 可以在 admin 直接粘贴一条想法。
// POST /api/admin/raw 通了：onAdd 走 useRaw().addRaw，成功后 textarea 清空。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import type { CreateRawInput } from '@/lib/api/admin';

type Props = {
  submitting: boolean;
  submitError: string | null;
  onAdd: (input: CreateRawInput) => Promise<boolean>;
};

export function RawDumpBox({ submitting, submitError, onAdd }: Props) {
  const [text, setText] = useState('');
  const handleAdd = useCallback(async () => {
    const trimmed = text.trim();
    const ok = trimmed !== '' && await onAdd({ body: trimmed, source: 'admin' });
    ok && setText('');
  }, [text, onAdd]);
  return (
    <div className="border border-dashed border-(--color-rule) bg-(--color-surface)/40 rounded-sm p-4 relative">
      <RawDumpHead />
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

function RawDumpHead() {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) flex items-baseline gap-2">
        <span>quick dump</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-faint)">paste a thought · then promote</span>
      </div>
      <span className="mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-faint)">
        admin · or mcp
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
  return (
    <div className="flex items-center justify-between mt-3 gap-3">
      <FooterHint error={error} />
      <Btn kind="primary" onClick={onAdd} disabled={disabled}>
        {submitting ? 'dumping…' : 'dump ↵'}
      </Btn>
    </div>
  );
}

function FooterHint({ error }: { error: string | null }) {
  return error
    ? <span className="mono text-[10px] text-(--color-accent) tracking-[0.06em]">{error}</span>
    : <span className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        raw stays unindexed until promoted
      </span>;
}
