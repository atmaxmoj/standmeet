// ApiSection —— /admin/api-mcp 的设计稿版本。
// 顶部 SectionHeader + intro + new-token 表单（NewTokenInline）。
// 下方：TokenRow 列表 + AI provider panel + MCPClientPanel + MCPDownloadPanel。
// e2e testid 保留：new-token / token-name / token-create / token-plaintext / token-list /
//   token-delete-{name}。

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { NewlyCreatedBanner } from '@/components/admin/sections/api/NewlyCreatedBanner';
import { NewTokenInline } from '@/components/admin/sections/api/NewTokenInline';
import { TokenRow } from '@/components/admin/sections/api/TokenRow';
import { MCPClientPanel } from '@/components/admin/sections/api/MCPClientPanel';
import { MCPDownloadPanel } from '@/components/admin/sections/api/MCPDownloadPanel';
import { MCPServersPanel } from '@/components/admin/sections/api/MCPServersPanel';
import { AIProviderPanel } from '@/components/admin/sections/api/AIProviderPanel';
import { APIKeysPanel } from '@/components/admin/sections/api/APIKeysPanel';
import { ProviderBookPanel } from '@/components/admin/sections/api/ProviderBookPanel';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useTokens, type TokenItem, type TokensHook } from '@/lib/admin/use-tokens';

export function ApiSection() {
  const hook = useTokens();
  return (
    <>
      <SectionHeader
        kicker="integrations · programmatic"
        slug="api-mcp"
        count={titleCount(hook)}
      />
      <ApiBody hook={hook} />
    </>
  );
}

function titleCount(hook: TokensHook): string {
  return hook.status === 'ready'
    ? `${hook.tokens.length} key${hook.tokens.length === 1 ? '' : 's'}`
    : '';
}

function ApiBody({ hook }: { hook: TokensHook }) {
  return hook.status === 'idle' || hook.status === 'loading'
    ? <LoadingState />
    : <Ready hook={hook} />;
}

function LoadingState() {
  return (
    <div className="space-y-10">
      <Intro />
      <ListSkeleton count={3} />
    </div>
  );
}

function Ready({ hook }: { hook: TokensHook }) {
  return (
    <div className="space-y-10">
      <Intro />
      <TokensBlock hook={hook} />
      {/* 外发 API key 紧跟在 MCP keypair 后面：两种 key 都在这一页,挨着放才看得出它们是
          两件事(F-K-1)。上面那批是 owner 自己客户端签名用的,这批是给第三方程序的。 */}
      <APIKeysPanel />
      <AIProviderPanel />
      <ProviderBookPanel />
      <MCPClientPanel />
      <MCPDownloadPanel />
      <MCPServersPanel />
    </div>
  );
}

function Intro() {
  const t = useTranslations('adminIntegrations.api');
  return (
    <p className="reading-tight text-(--color-muted) text-[15px] max-w-[54em]">
      {t.rich('intro', {
        code: (chunks) => <code className="mono text-[12.5px]">{chunks}</code>,
      })}
    </p>
  );
}

function TokensBlock({ hook }: { hook: TokensHook }) {
  const t = useTranslations('adminIntegrations.api');
  return (
    <div>
      <AdminSectionHead className="mb-3">{t('keysHeading')}</AdminSectionHead>
      <NewlyCreatedBanner created={bannerView(hook.justCreated)} dismiss={hook.dismissCreated} />
      <NewTokenInline createToken={hook.createToken} error={hook.error} />
      <TokenList tokens={hook.tokens} deleteToken={hook.deleteToken} />
    </div>
  );
}

// bannerView —— hook.justCreated 形态是 { id, name, plaintext, created_at }；
// NewlyCreatedBanner 只用 id/name/plaintext。narrow 一下避免传整个 store
// 形态 (含 created_at 是日期 string，不需要)。
function bannerView(c: TokensHook['justCreated']):
  { id: string; name: string; plaintext: string } | null {
  return c
    ? { id: c.id, name: c.name, plaintext: c.plaintext }
    : null;
}

function TokenList({
  tokens, deleteToken,
}: { tokens: readonly TokenItem[]; deleteToken: (id: string) => Promise<void> }) {
  return tokens.length === 0
    ? <EmptyTokens />
    : (
      <ul className="space-y-3" data-testid="token-list">
        {tokens.map((t) => <TokenRow key={t.id} token={t} deleteToken={deleteToken} />)}
      </ul>
    );
}

function EmptyTokens() {
  const t = useTranslations('adminIntegrations.api');
  return (
    <div data-testid="token-list" className="sm-empty mono text-[11px] text-(--color-faint)">
      {t('empty')}
    </div>
  );
}
