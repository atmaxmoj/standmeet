// APITokens —— /admin/api-mcp section 内容。
// 列出现有 token，"create" 表单返回 plaintext 仅一次。

'use client';

import { useCallback, useState } from 'react';

import { SectionHeader } from './SectionHeader';

import { useTokens, type TokenItem, type TokensHook } from '@/lib/admin/use-tokens';

export function APITokens() {
  const hook = useTokens();
  return (
    <>
      <SectionHeader title="api · mcp" subtitle="bearer tokens for MCP clients (one plaintext view per token)" />
      <APITokensBody hook={hook} />
    </>
  );
}

function APITokensBody({ hook }: { hook: TokensHook }) {
  return hook.state.kind === 'loading' ? <Loading />
    : hook.state.kind === 'error' ? <ErrorMsg message={hook.state.message} />
    : <Ready hook={hook} state={hook.state} />;
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function Ready({
  hook, state,
}: {
  hook: TokensHook;
  state: Extract<TokensHook['state'], { kind: 'ready' }>;
}) {
  return (
    <div className="space-y-8">
      <NewlyCreated created={state.justCreated} dismiss={hook.dismissCreated} />
      <CreateTokenForm createToken={hook.createToken} error={state.error} />
      <TokenList tokens={state.tokens} deleteToken={hook.deleteToken} />
    </div>
  );
}

function NewlyCreated({
  created, dismiss,
}: {
  created: Extract<TokensHook['state'], { kind: 'ready' }>['justCreated'];
  dismiss: () => void;
}) {
  return created ? <NewlyCreatedCard plaintext={created.plaintext} name={created.name} dismiss={dismiss} /> : null;
}

function NewlyCreatedCard({
  plaintext, name, dismiss,
}: { plaintext: string; name: string; dismiss: () => void }) {
  return (
    <div className="border border-(--color-accent) p-4 space-y-2" data-testid="new-token">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-accent)">
        copy this now — you won&apos;t see it again
      </div>
      <div className="reading text-sm text-(--color-muted)">{name}</div>
      <code className="mono text-sm break-all block" data-testid="token-plaintext">{plaintext}</code>
      <button
        type="button"
        onClick={dismiss}
        className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-ink)"
      >
        dismiss
      </button>
    </div>
  );
}

function CreateTokenForm({
  createToken, error,
}: { createToken: (name: string) => Promise<void>; error: string | null }) {
  const [name, setName] = useState('');
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    trimmed === '' || await submitNewToken(trimmed, createToken, setName);
  }, [name, createToken]);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
          create token
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 'mojat-mbp'"
          data-testid="token-name"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </label>
      <CreateError message={error} />
      <button
        type="submit"
        data-testid="token-create"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5"
      >
        create
      </button>
    </form>
  );
}

async function submitNewToken(
  trimmed: string,
  createToken: (name: string) => Promise<void>,
  setName: (v: string) => void,
): Promise<void> {
  await createToken(trimmed);
  setName('');
}

function CreateError({ message }: { message: string | null }) {
  return message ? <p className="mono text-xs text-(--color-accent)">{message}</p> : null;
}

function TokenList({
  tokens, deleteToken,
}: { tokens: TokenItem[]; deleteToken: (id: string) => Promise<void> }) {
  return tokens.length === 0
    ? <p className="reading italic text-(--color-muted)">No tokens yet.</p>
    : (
      <ul className="space-y-3" data-testid="token-list">
        {tokens.map((t) => <TokenRow key={t.id} token={t} deleteToken={deleteToken} />)}
      </ul>
    );
}

function TokenRow({
  token, deleteToken,
}: { token: TokenItem; deleteToken: (id: string) => Promise<void> }) {
  return (
    <li className="flex items-center justify-between border-b border-(--color-rule) pb-3">
      <div>
        <div className="reading">{token.name}</div>
        <div className="mono text-[10px] text-(--color-muted)">created {token.created_at}</div>
      </div>
      <button
        type="button"
        onClick={() => void deleteToken(token.id)}
        data-testid={`token-delete-${token.name}`}
        className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)"
      >
        delete
      </button>
    </li>
  );
}
