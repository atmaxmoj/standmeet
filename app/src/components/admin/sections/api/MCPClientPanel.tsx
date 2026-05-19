// MCPClientPanel —— 让 owner 一眼看到 claude_desktop_config / cursor mcp.json / curl
// 三种调用方式。token 选 dropdown，client 选 tabs。

'use client';

import { useState } from 'react';

import { MCP_CLIENTS, type MCPClient, type TokenItem } from '@/lib/admin/use-tokens';

const HOST = 'https://standmeet.local';

type Props = { tokens: readonly TokenItem[] };

export function MCPClientPanel({ tokens }: Props) {
  const [clientId, setClientId] = useState<MCPClient['id']>(MCP_CLIENTS[0]!.id);
  const [tokenId, setTokenId] = useState<string>(tokens[0]?.id ?? '');
  const client = pickClient(clientId);
  const snippet = renderSnippet(client, tokens, tokenId);
  return (
    <div className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5">
      <span className="ch-tl" /><span className="ch-br" />
      <PanelHead />
      <ClientTabs current={clientId} setClient={setClientId} />
      <PathRow path={client.path.replace('{host}', HOST)} />
      <TokenPicker tokens={tokens} tokenId={tokenId} setTokenId={setTokenId} />
      <SnippetBlock snippet={snippet} />
      <PanelFoot />
    </div>
  );
}

function renderSnippet(
  client: MCPClient,
  tokens: readonly TokenItem[],
  tokenId: string,
): string {
  const token = tokens.find((t) => t.id === tokenId);
  const keyDisplay = token ? `sm_live_${token.id}_redacted` : 'sm_live_<your-token>';
  return client.snippet(keyDisplay, HOST);
}

function pickClient(id: MCPClient['id']): MCPClient {
  return MCP_CLIENTS.find((c) => c.id === id) ?? MCP_CLIENTS[0]!;
}

function PanelHead() {
  return (
    <div className="flex items-baseline justify-between mb-4 gap-4 flex-wrap">
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink)">mcp setup</h3>
      <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint)">
        paste into your AI client to push entries directly into your corpus
      </span>
    </div>
  );
}

function ClientTabs({
  current, setClient,
}: { current: MCPClient['id']; setClient: (id: MCPClient['id']) => void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1 mb-4 border-b border-(--color-rule)">
      {MCP_CLIENTS.map((c) => (
        <ClientTab key={c.id} client={c} active={c.id === current} onClick={() => setClient(c.id)} />
      ))}
    </div>
  );
}

function ClientTab({
  client, active, onClick,
}: { client: MCPClient; active: boolean; onClick: () => void }) {
  const cls = active
    ? 'text-(--color-ink) border-b border-(--color-accent) -mb-px'
    : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mono text-[10.5px] tracking-[0.12em] uppercase px-3 py-2 transition-colors ${cls}`}
    >
      {client.label}
    </button>
  );
}

function PathRow({ path }: { path: string }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">config path</div>
      <div className="mono text-[12.5px] text-(--color-ink) truncate mb-3">{path}</div>
    </div>
  );
}

function TokenPicker({
  tokens, tokenId, setTokenId,
}: { tokens: readonly TokenItem[]; tokenId: string; setTokenId: (id: string) => void }) {
  return (
    <div className="mb-3">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">use token</div>
      <select
        value={tokenId}
        onChange={(e) => setTokenId(e.target.value)}
        className="bg-transparent border-b border-(--color-rule) mono text-[12px] py-1 pr-6 text-(--color-ink) focus:border-(--color-ink)"
      >
        <EmptyOption shown={tokens.length === 0} />
        {tokens.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  );
}

function EmptyOption({ shown }: { shown: boolean }) {
  return shown ? <option value="">no tokens yet · create one first</option> : null;
}

function SnippetBlock({ snippet }: { snippet: string }) {
  return (
    <pre className="mono text-[12.5px] leading-[1.55] text-(--color-ink) bg-(--color-paper) border border-(--color-rule) rounded-sm p-4 overflow-x-auto whitespace-pre">
{snippet}
    </pre>
  );
}

function PanelFoot() {
  return (
    <div className="mt-4 mono text-[10px] tracking-[0.06em] text-(--color-faint) leading-[1.7]">
      after pasting, restart your client. the standmeet tool will appear with capabilities like{' '}
      <span className="text-(--color-muted)">raw_dump</span>,{' '}
      <span className="text-(--color-muted)">promote_to_wiki</span>,{' '}
      <span className="text-(--color-muted)">search_corpus</span>.
    </div>
  );
}
