// ApiSection —— the design-spec version of /admin/api-mcp.
// Top: SectionHeader + intro + new-token form (NewTokenInline).
// Below: TokenRow list + AI provider panel + MCPClientPanel + MCPDownloadPanel.
// e2e testids kept: new-token / token-name / token-create / token-plaintext / token-list /
//   token-delete-{name}.

'use client';

import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { NewlyCreatedBanner } from '@/components/admin/sections/api/NewlyCreatedBanner';
import { NewTokenInline } from '@/components/admin/sections/api/NewTokenInline';
import { TokenRow } from '@/components/admin/sections/api/TokenRow';
import { MCPClientPanel } from '@/components/admin/sections/api/MCPClientPanel';
import { MCPDownloadPanel } from '@/components/admin/sections/api/MCPDownloadPanel';
import { EmbedPanel } from '@/components/admin/sections/api/EmbedPanel';
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
      {/* The outbound API key sits right after the MCP keypair: both kinds of key live
          on this page, and placing them next to each other is what makes it clear they
          are two different things (F-K-1). The block above is for the owner's own client
          to sign with; this one is for third-party programs. */}
      <APIKeysPanel />
      <AIProviderPanel />
      <ProviderBookPanel />
      <MCPClientPanel />
      <MCPDownloadPanel />
      <MCPServersPanel />
      {/* embed goes last: the blocks above are the owner's own programs connecting in;
          this one is the reverse — it puts this instance's chat on **someone else's
          website**. */}
      <EmbedPanel />
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
      <ListPane status={hook.status} count={hook.tokens.length} empty={<EmptyTokens />}>
        <TokenList tokens={hook.tokens} deleteToken={hook.deleteToken} />
      </ListPane>
    </div>
  );
}

// bannerView —— hook.justCreated has the shape { id, name, plaintext, created_at };
// NewlyCreatedBanner only uses id/name/plaintext. Narrow it here so we don't pass the
// whole store shape (created_at is a date string we don't need).
function bannerView(c: TokensHook['justCreated']):
  { id: string; name: string; plaintext: string } | null {
  return c
    ? { id: c.id, name: c.name, plaintext: c.plaintext }
    : null;
}

function TokenList({
  tokens, deleteToken,
}: { tokens: readonly TokenItem[]; deleteToken: (id: string) => Promise<void> }) {
  return (
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
