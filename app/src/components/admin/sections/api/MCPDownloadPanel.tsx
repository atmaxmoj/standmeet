// MCPDownloadPanel — hands owner the real MCP endpoint (what Claude Desktop
// / Cursor point at). Honesty fix: it used to pretend a downloadable
// standmeet-mcp binary existed — all 4 platform links pointed at a
// nonexistent github.com/standmeet/mcp-client, the filename/size (11 MB etc.)
// were all made up, and clicking them was a dead link. The endpoint itself
// is real (#143 as-MCP-server facade: /mcp, Sigv1 auth). The stdio client
// (npx @standmeet/mcp-client) is already published and used by the config in
// MCPClientPanel above, so the note now honestly says that's the actual path
// (F-M-1: the old copy said "wrapper not yet published", contradicting the
// config served on the same page).

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';

// useMcpEndpoint — this instance's MCP endpoint (origin/mcp under a
// single-domain deployment). Reads window only after mount to avoid an
// SSR mismatch.
function useMcpEndpoint(): string {
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  return `${origin}/mcp`;
}

export function MCPDownloadPanel() {
  const endpoint = useMcpEndpoint();
  const t = useTranslations('adminIntegrations.mcpDownload');
  return (
    <div>
      <Header />
      <p className="reading-tight text-(--color-muted) text-[14.5px]">
        {t('intro')}
      </p>
      <EndpointBlock endpoint={endpoint} />
      <p className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint) mt-4 leading-relaxed">
        {t('note')}
      </p>
    </div>
  );
}

function Header() {
  const t = useTranslations('adminIntegrations.mcpDownload');
  return (
    <AdminSectionHead className="mb-3" aside={t('badge')}>{t('heading')}</AdminSectionHead>
  );
}

function EndpointBlock({ endpoint }: { endpoint: string }) {
  const t = useTranslations('adminIntegrations.mcpDownload');
  return (
    <div
      data-testid="mcp-endpoint"
      className="mt-5 border border-(--color-rule) rounded-sm p-3.5 bg-(--color-surface)/30"
    >
      <div className="mono text-[9.5px] tracking-[0.12em] uppercase text-(--color-faint) mb-1">
        {t('endpointLabel')}
      </div>
      <code className="mono text-[12px] text-(--color-ink) break-all select-all">{endpoint}</code>
    </div>
  );
}
