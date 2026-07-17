// MCPDownloadPanel —— 把 owner 的真 MCP 端点交到手上(Claude Desktop / Cursor 指过去)。
// 诚实修正:原先假装有可下载的 standmeet-mcp 二进制 —— 4 个平台链接全指向不存在的
// github.com/standmeet/mcp-client,文件名/大小(11 MB 等)全是编的,点了是死链。端点本身是真的
// (#143 as-MCP-server facade:/mcp,Sigv1 auth);打包 client 包装器尚未发布,如实说明。

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

// useMcpEndpoint —— 本实例的 MCP 端点(单域部署下 origin/mcp)。mount 后读 window 避免 SSR 不一致。
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
    <div className="flex items-baseline justify-between mb-3 pb-2 border-b border-(--color-rule)">
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink)">
        {t('heading')}
      </h3>
      <span className="mono text-[10.5px] tracking-[0.06em] text-(--color-faint)">{t('badge')}</span>
    </div>
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
