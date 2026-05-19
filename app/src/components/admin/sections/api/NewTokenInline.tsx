// NewTokenInline —— 输入 name 后点 create。保留 e2e testid（token-name / token-create）。

'use client';

import { useCallback, useState } from 'react';

type Props = {
  createToken: (name: string) => Promise<void>;
  error: string | null;
};

export function NewTokenInline({ createToken, error }: Props) {
  const [name, setName] = useState('');
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    trimmed === '' || await submit(trimmed, createToken, setName);
  }, [name, createToken]);
  return (
    <form onSubmit={onSubmit} className="space-y-3 mb-4">
      <NameField name={name} onChange={setName} />
      <ErrorBox message={error} />
      <SubmitBtn />
    </form>
  );
}

async function submit(
  trimmed: string,
  createToken: (n: string) => Promise<void>,
  setName: (v: string) => void,
): Promise<void> {
  await createToken(trimmed);
  setName('');
}

function NameField({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        create token
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 'cursor-mbp'"
        data-testid="token-name"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading-tight text-base"
      />
    </label>
  );
}

function ErrorBox({ message }: { message: string | null }) {
  return message ? <p className="mono text-xs text-(--color-accent)">{message}</p> : null;
}

function SubmitBtn() {
  return (
    <button
      type="submit"
      data-testid="token-create"
      className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5"
    >
      create
    </button>
  );
}
