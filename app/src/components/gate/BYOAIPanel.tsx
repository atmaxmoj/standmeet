// BYOAIPanel —— gate "no code? BYOAI"：左侧解释 + 右侧 provider/key 表单。
// e2e selectOption('byoai-provider') 要求 provider 是 <select>，所以视觉
// 上当 chip 装但 DOM 还是 <select>。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook, Provider } from '@/lib/gate/use-gate';

type Props = {
  hook: GateHook;
};

export function BYOAIPanel({ hook }: Props) {
  const router = useRouter();
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [reveal, setReveal] = useState(false);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    trimmed !== '' && (await runBYOAISubmit(provider, trimmed, hook, router));
  }, [apiKey, provider, hook, router]);

  return (
    <section id="byoai" data-testid="byoai-panel">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <BYOAIHeadline />
        <BYOAIForm
          provider={provider} setProvider={setProvider}
          apiKey={apiKey} setApiKey={setApiKey}
          reveal={reveal} setReveal={setReveal}
          onSubmit={onSubmit} busy={hook.state.busy}
        />
      </div>
    </section>
  );
}

function BYOAIHeadline() {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-2">
        <span>no code?</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-accent)">BYOAI</span>
      </div>
      <h2
        className="font-serif text-(--color-ink)"
        style={{ fontSize: '28px', fontWeight: 400, letterSpacing: '-0.015em', lineHeight: 1.1 }}
      >
        Bring your own AI<span className="text-(--color-accent)">.</span>
      </h2>
      <p className="reading text-(--color-muted) mt-3" style={{ fontSize: '15.5px' }}>
        Use your own Anthropic / OpenAI key against the owner&rsquo;s public corpus. Private topics
        return &ldquo;need a code&rdquo;.
      </p>
      <ul className="mt-5 mono text-[10.5px] tracking-[0.06em] leading-[1.85] text-(--color-muted)">
        <li><span className="text-(--color-faint)">·</span> your key stays in your browser</li>
        <li><span className="text-(--color-faint)">·</span> owner pays for retrieval, you pay for inference</li>
        <li><span className="text-(--color-faint)">·</span> private topics return &ldquo;ask for a code&rdquo;</li>
      </ul>
    </div>
  );
}

type FormProps = {
  provider: Provider;
  setProvider: (p: Provider) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  reveal: boolean;
  setReveal: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
};

function BYOAIForm(p: FormProps) {
  return (
    <form onSubmit={p.onSubmit} className="rise">
      <ProviderRow value={p.provider} onChange={p.setProvider} />
      <KeyRow
        value={p.apiKey} onChange={p.setApiKey}
        reveal={p.reveal} onToggleReveal={() => p.setReveal(!p.reveal)}
      />
      <ReadyRow apiKey={p.apiKey} busy={p.busy} />
    </form>
  );
}

function ProviderRow({ value, onChange }: { value: Provider; onChange: (p: Provider) => void }) {
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        choose a model
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Provider)}
        data-testid="byoai-provider"
        className="provider-pick is-on mb-5 cursor-pointer"
      >
        <option value="anthropic">claude</option>
        <option value="openai">openai</option>
      </select>
    </>
  );
}

function KeyRow({
  value, onChange, reveal, onToggleReveal,
}: { value: string; onChange: (v: string) => void; reveal: boolean; onToggleReveal: () => void }) {
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline justify-between">
        <span>api key</span>
        <span className="text-(--color-faint) lowercase tracking-[0.06em] text-[10px]">
          keys start with sk-ant-… or sk-…
        </span>
      </div>
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1">
        <input
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-ant-…"
          data-testid="byoai-key"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent mono py-2 reading text-(--color-ink) placeholder:text-(--color-faint)"
          style={{ fontSize: '15.5px', letterSpacing: '0.02em' }}
        />
        <button
          type="button"
          onClick={onToggleReveal}
          className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-ink) shrink-0"
        >
          {reveal ? 'hide' : 'reveal'}
        </button>
      </div>
    </>
  );
}

function ReadyRow({ apiKey, busy }: { apiKey: string; busy: boolean }) {
  const valid = apiKey.trim().length > 12;
  return (
    <div className="mt-4 mono text-[10px] tracking-[0.06em] text-(--color-muted) flex items-baseline justify-between gap-3 flex-wrap">
      <ReadyHint valid={valid} apiKey={apiKey} />
      <SubmitButton disabled={!valid || busy} busy={busy} />
    </div>
  );
}

function ReadyHint({ valid, apiKey }: { valid: boolean; apiKey: string }) {
  return valid
    ? <span>ready · using <MaskedKey value={apiKey} /></span>
    : <span className="text-(--color-faint)">paste your key to unlock the public chat.</span>;
}

function MaskedKey({ value }: { value: string }) {
  const tail = value.slice(-4);
  return (
    <span className="mono text-[11px] tracking-[0.04em] text-(--color-muted)">
      {Array.from({ length: 12 }).map((_, i) => <span key={i} className="keydot" />)}
      <span className="ml-1 text-(--color-ink)">{tail}</span>
    </span>
  );
}

function SubmitButton({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      data-testid="byoai-submit"
      className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors disabled:opacity-40 shrink-0"
    >
      {busy ? 'warming up…' : 'start public chat ↗'}
    </button>
  );
}

async function runBYOAISubmit(
  provider: Provider,
  key: string,
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitBYOAI(provider, key);
  // 落根 / —— byoai 状态在 localStorage（use-gate.persistSession），
  // page-shell mount 时读 store，URL 不挂 flag。
  ok && router.push('/');
}
