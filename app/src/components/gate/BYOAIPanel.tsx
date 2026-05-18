// BYOAIPanel —— /<handle>/gate 第二栏：visitor 自带 API key，public-scope only。
//
// UI 完整 + 后端 byoai-tier session（visibility=public 强制）。Provider
// 当前用 server-side mock 兜底，key 收下不调（visitor "pays nothing"）；
// 真正"visitor pays / browser direct call Anthropic" 留作后续。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook, Provider } from '@/lib/gate/use-gate';

type Props = {
  handle: string;
  hook: GateHook;
};

export function BYOAIPanel({ handle, hook }: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [key, setKey] = useState('');

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    trimmed !== '' && (await runBYOAISubmit(handle, provider, trimmed, hook, router));
  }, [key, provider, handle, hook, router]);

  return (
    <section className="rise" data-testid="byoai-panel">
      <PanelHeader />
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <ProviderSelect provider={provider} onChange={setProvider} />
        <KeyInput value={key} onChange={setKey} />
        <SubmitButton busy={hook.state.busy} />
      </form>
    </section>
  );
}

function PanelHeader() {
  return (
    <header>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted)">
        bring your own API key
      </div>
      <p className="reading italic text-(--color-muted) mt-2 text-base">
        Chat with the public slice of this corpus using your own API key. Private topics stay gated.
      </p>
    </header>
  );
}

function ProviderSelect({
  provider, onChange,
}: { provider: Provider; onChange: (p: Provider) => void }) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">provider</div>
      <select
        value={provider}
        onChange={(e) => onChange(e.target.value as Provider)}
        data-testid="byoai-provider"
        className="bg-transparent border-b border-(--color-rule) reading text-base py-2 pr-8"
      >
        <option value="anthropic">Anthropic</option>
        <option value="openai">OpenAI</option>
      </select>
    </label>
  );
}

function KeyInput({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">api key</div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="sk-ant-… or sk-…"
        data-testid="byoai-key"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
      />
    </label>
  );
}

function SubmitButton({ busy }: { busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      data-testid="byoai-submit"
      className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
    >
      {busy ? 'working…' : 'start chatting ↵'}
    </button>
  );
}

async function runBYOAISubmit(
  handle: string,
  provider: Provider,
  key: string,
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitBYOAI(handle, provider, key);
  ok && router.push(`/${handle}?byoai=1`);
}
