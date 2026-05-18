// CodePanel —— /<handle>/gate 第一栏：输 LABEL-XXX 进 owner 的 corpus。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook } from '@/lib/gate/use-gate';

type Props = {
  handle: string;
  hook: GateHook;
};

export function CodePanel({ handle, hook }: Props) {
  const router = useRouter();
  const [code, setCode] = useState('');

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    trimmed !== '' && (await runCodeSubmit(handle, trimmed, hook, router));
  }, [code, handle, hook, router]);

  return (
    <section className="rise" data-testid="code-panel">
      <PanelHeader title="have a code?" subtitle={`Enter a LABEL-XXX code ${handle} gave you.`} />
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="INTRO-001"
          data-testid="gate-code"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-lg tracking-wider"
        />
        <SubmitButton busy={hook.state.busy} label="enter ↵" testid="gate-code-submit" />
      </form>
    </section>
  );
}

async function runCodeSubmit(
  handle: string,
  code: string,
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitCode(handle, code);
  ok && router.push(`/${handle}`);
}

function PanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">{title}</div>
      <p className="reading italic text-(--color-muted) mt-2 text-base">{subtitle}</p>
    </header>
  );
}

function SubmitButton({
  busy, label, testid,
}: { busy: boolean; label: string; testid: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      data-testid={testid}
      className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
    >
      {busy ? 'working…' : label}
    </button>
  );
}
