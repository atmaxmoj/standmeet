// AIProviderPanel —— /admin/api-mcp 上的 "owner's AI" block。
//
// owner 选 provider（anthropic / openai / mock）+ 贴 key。明文 key 不在
// response 里回；only "● key set" 状态。重设 key 直接 fill 新值，旧 key
// 被替换。点 "clear" 切回 mock 模式 + 清 key。

'use client';

import { useState } from 'react';

import {
  useAIProvider, applySaveSuccess,
  type AIProviderHook, type AIProviderName,
} from '@/lib/admin/use-ai-provider';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

const PROVIDERS: readonly AIProviderName[] = ['anthropic', 'openai'];

export function AIProviderPanel() {
  const hook = useAIProvider();
  useEffectErrorToast(hook.state.error);
  return (
    <div data-testid="ai-provider-panel">
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink) mb-3 pb-2 border-b border-(--color-rule)">
        owner&apos;s ai
      </h3>
      <Intro />
      <PanelBody hook={hook} />
    </div>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) text-[14.5px] max-w-[54em] mb-4">
      The provider visitors talk to. Anthropic or OpenAI — bring your own key. It&apos;s encrypted
      at rest with INSTANCE_SECRET and never read back to this page.
    </p>
  );
}

function PanelBody({ hook }: { hook: AIProviderHook }) {
  return hook.state.loading
    ? <Loading />
    : <PanelForm hook={hook} />;
}

function Loading() {
  return <p className="mono text-[11px] text-(--color-faint)">loading…</p>;
}

function PanelForm({ hook }: { hook: AIProviderHook }) {
  const [provider, setProvider] = useState<AIProviderName>(hook.state.provider);
  const [key, setKey] = useState('');
  return (
    <div className="space-y-4">
      <ProviderRow provider={provider} onChange={setProvider} />
      <KeyRow keyText={key} setKey={setKey} configured={hook.state.keyConfigured} />
      <ButtonsRow hook={hook} provider={provider} keyText={key} setKey={setKey} />
    </div>
  );
}

function ProviderRow({
  provider, onChange,
}: { provider: AIProviderName; onChange: (p: AIProviderName) => void }) {
  return (
    <div>
      <Label>provider</Label>
      <div className="flex gap-2 flex-wrap">
        {PROVIDERS.map((p) => (
          <ProviderBtn key={p} p={p} active={p === provider} onPick={onChange} />
        ))}
      </div>
    </div>
  );
}

function ProviderBtn({
  p, active, onPick,
}: { p: AIProviderName; active: boolean; onPick: (p: AIProviderName) => void }) {
  const cls = active
    ? 'bg-(--color-ink) text-(--color-paper)'
    : 'bg-transparent border border-(--color-rule) text-(--color-muted)';
  return (
    <button
      type="button"
      onClick={() => onPick(p)}
      data-testid={`ai-provider-${p}`}
      className={`mono text-[10px] tracking-[0.16em] uppercase px-3 py-1.5 hover:border-(--color-ink) ${cls}`}
    >
      {p}
    </button>
  );
}

function KeyRow({
  keyText, setKey, configured,
}: { keyText: string; setKey: (v: string) => void; configured: boolean }) {
  return (
    <div>
      <Label>api key</Label>
      <input
        type="password"
        value={keyText}
        onChange={(e) => setKey(e.target.value)}
        placeholder={configured ? '● already set · type to replace' : 'paste key here'}
        spellCheck={false}
        autoComplete="off"
        data-testid="ai-provider-key"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
      />
      <KeyHint configured={configured} typing={keyText !== ''} />
    </div>
  );
}

function KeyHint({ configured, typing }: { configured: boolean; typing: boolean }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.04em] text-(--color-faint) mt-1">
      {typing ? 'will replace existing key on save'
        : configured ? '● key set · leave blank to keep'
        : '○ not set'}
    </div>
  );
}

function ButtonsRow({
  hook, provider, keyText, setKey,
}: {
  hook: AIProviderHook;
  provider: AIProviderName;
  keyText: string;
  setKey: (v: string) => void;
}) {
  const toast = useToast();
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <SaveBtn
        provider={provider} keyText={keyText} hook={hook} toast={toast} setKey={setKey}
      />
      <ClearBtn hook={hook} toast={toast} setKey={setKey} />
    </div>
  );
}

function SaveBtn({
  provider, keyText, hook, toast, setKey,
}: {
  provider: AIProviderName;
  keyText: string;
  hook: AIProviderHook;
  toast: ReturnType<typeof useToast>;
  setKey: (v: string) => void;
}) {
  const onSave = async () => {
    const ok = await hook.save({ provider, key: keyText });
    applySaveSuccess(ok, () => setKey(''), () => toast.success('AI provider saved'));
  };
  return (
    <button
      type="button"
      onClick={() => void onSave()}
      disabled={hook.state.saving}
      data-testid="ai-provider-save"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-3 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {hook.state.saving ? 'saving…' : 'save'}
    </button>
  );
}

function ClearBtn({
  hook, toast, setKey,
}: {
  hook: AIProviderHook;
  toast: ReturnType<typeof useToast>;
  setKey: (v: string) => void;
}) {
  const onClear = async () => {
    const ok = await hook.clearKey();
    applySaveSuccess(ok, () => setKey(''), () => toast.success('AI provider cleared'));
  };
  return hook.state.keyConfigured ? (
    <button
      type="button"
      onClick={() => void onClear()}
      data-testid="ai-provider-clear"
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-faint) hover:text-(--color-accent)"
    >
      clear key ×
    </button>
  ) : null;
}

function Label({ children }: { children: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
      {children}
    </div>
  );
}
