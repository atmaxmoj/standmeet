// CodePanel —— gate Hero 里的 code + 名字输入栏。
//
// 同一个 code 可以发给多人，所以 owner 区分访客靠"输入名字"。一个 (code,
// display_name) 唯一定位 member；后端 GetOrCreateCodeMember upsert。访客填
// 完两个字段才提交，name 留空走 "anonymous" 路径（实际后端会创一个
// is_anonymous=true 的 row）。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook } from '@/lib/gate/use-gate';

type Props = {
  hook: GateHook;
};

export function CodePanel({ hook }: Props) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    trimmedCode !== '' && (await runCodeSubmit(trimmedCode, name, hook, router));
  }, [code, name, hook, router]);

  return (
    <section data-testid="code-panel">
      <form onSubmit={onSubmit} className="space-y-3">
        <CodeRow code={code} setCode={setCode} busy={hook.state.busy} />
        <NameRow name={name} setName={setName} />
      </form>
      <Hint />
    </section>
  );
}

function CodeRow({
  code, setCode, busy,
}: { code: string; setCode: (v: string) => void; busy: boolean }) {
  return (
    <div className="flex items-baseline gap-4 py-3 border-t-[1.5px] border-b-[1.5px] border-(--color-ink) relative">
      <span className="text-(--color-accent) font-serif shrink-0 text-[28px] leading-none">›</span>
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="LABEL–NNN"
        data-testid="gate-code"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent mono text-(--color-ink) placeholder:text-(--color-faint) min-w-0 text-[24px] tracking-[0.08em] uppercase"
      />
      <CodeSubmit busy={busy} />
    </div>
  );
}

function NameRow({ name, setName }: { name: string; setName: (v: string) => void }) {
  return (
    <div className="flex items-baseline gap-3 py-2 border-b border-(--color-rule)">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) shrink-0">
        your name
      </span>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Sarah (Acme HR)"
        data-testid="gate-visitor-name"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent reading-tight text-[15px] text-(--color-ink) placeholder:text-(--color-faint) min-w-0"
      />
    </div>
  );
}

function Hint() {
  return (
    <p className="mono text-[10.5px] tracking-[0.12em] text-(--color-faint) mt-4 leading-[1.7] max-w-[40em]">
      codes look like <span className="text-(--color-muted)">INTRO–001</span>. they arrive by
      email from the owner directly · case doesn&rsquo;t matter · paste the whole thing.
      <span className="block mt-1">your name lets the owner separate visitors who share a code.</span>
    </p>
  );
}

function CodeSubmit({ busy }: { busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      data-testid="gate-code-submit"
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1"
    >
      {busy ? 'checking…' : <>enter <span className="text-[14px]">↵</span></>}
    </button>
  );
}

async function runCodeSubmit(
  code: string,
  name: string,
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitCode(code, name);
  ok && router.push('/');
}
