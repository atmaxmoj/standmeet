// MCPClientPanel —— /admin/api-mcp 安装说明面板。Phase C 起客户端通过
// `STANDMEET_CREDS_PATH` 指向 owner 本地 credentials.json (keyId +
// privateKeyPem)；不再把 plaintext key 塞 env var。

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { MCP_CLIENTS, type MCPClient } from '@/lib/admin/use-tokens';

const HOST = 'https://standmeet.local';

export function MCPClientPanel() {
  const [clientId, setClientId] = useState<MCPClient['id']>(MCP_CLIENTS[0]!.id);
  const client = pickClient(clientId);
  const snippet = client.snippet(HOST);
  return (
    <div
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="mcp-install-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <PanelHead />
      <ClientTabs current={clientId} setClient={setClientId} />
      <PathRow path={client.path.replace('{host}', HOST)} />
      <SnippetBlock snippet={snippet} />
      <PanelFoot />
    </div>
  );
}

function pickClient(id: MCPClient['id']): MCPClient {
  return MCP_CLIENTS.find((c) => c.id === id) ?? MCP_CLIENTS[0]!;
}

function PanelHead() {
  const t = useTranslations('adminIntegrations.mcpClient');
  return (
    <AdminSectionHead className="mb-4 flex-wrap" aside={t('subhead')}>
      {t('heading')}
    </AdminSectionHead>
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
      data-testid={`mcp-client-tab-${client.id}`}
      className={`mono text-[10.5px] tracking-[0.12em] uppercase px-3 py-2 transition-colors ${cls}`}
    >
      {client.label}
    </button>
  );
}

function PathRow({ path }: { path: string }) {
  const t = useTranslations('adminIntegrations.mcpClient');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">{t('filePath')}</div>
      <div className="mono text-[12.5px] text-(--color-ink) truncate mb-3">{path}</div>
    </div>
  );
}

function SnippetBlock({ snippet }: { snippet: string }) {
  return (
    <pre
      data-testid="mcp-snippet"
      className="mono text-[12.5px] leading-[1.55] text-(--color-ink) bg-(--color-paper) border border-(--color-rule) rounded-sm p-4 overflow-x-auto whitespace-pre"
    >
{snippet}
    </pre>
  );
}

function PanelFoot() {
  const t = useTranslations('adminIntegrations.mcpClient');
  return (
    <div className="mt-4 mono text-[10px] tracking-[0.06em] text-(--color-faint) leading-[1.7]">
      {t('foot')}
    </div>
  );
}
