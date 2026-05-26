// ApiSection —— /admin/api-mcp 的设计稿版本。
// 顶部 SectionHeader + intro + new-token 表单（NewTokenInline）。
// 下方：TokenRow 列表 + AI provider panel + MCPClientPanel + MCPDownloadPanel。
// e2e testid 保留：new-token / token-name / token-create / token-plaintext / token-list /
//   token-delete-{name}。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { NewlyCreatedBanner } from '@/components/admin/sections/api/NewlyCreatedBanner';
import { NewTokenInline } from '@/components/admin/sections/api/NewTokenInline';
import { TokenRow } from '@/components/admin/sections/api/TokenRow';
import { MCPClientPanel } from '@/components/admin/sections/api/MCPClientPanel';
import { MCPDownloadPanel } from '@/components/admin/sections/api/MCPDownloadPanel';
import { AIProviderPanel } from '@/components/admin/sections/api/AIProviderPanel';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useTokens, type TokenItem, type TokensHook } from '@/lib/admin/use-tokens';

export function ApiSection() {
  const hook = useTokens();
  return (
    <>
      <SectionHeader
        kicker="integrations · programmatic"
        title="api · mcp"
        count={titleCount(hook)}
      />
      <ApiBody hook={hook} />
    </>
  );
}

function titleCount(hook: TokensHook): string {
  return hook.status === 'ready' ? `${hook.tokens.length} tokens` : '';
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
      <AIProviderPanel />
      <MCPClientPanel tokens={hook.tokens} />
      <MCPDownloadPanel />
    </div>
  );
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) text-[15px] max-w-[54em]">
      Tokens let AI clients (Claude, Cursor, custom scripts) push raw entries into your corpus and
      — at higher scopes — search, promote, or manage codes. Pair a token with the MCP client config
      below.
    </p>
  );
}

function TokensBlock({ hook }: { hook: TokensHook }) {
  return (
    <div>
      <h3 className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-ink) mb-3 pb-2 border-b border-(--color-rule)">
        api tokens
      </h3>
      <NewlyCreatedBanner created={hook.justCreated} dismiss={hook.dismissCreated} />
      <NewTokenInline createToken={hook.createToken} error={hook.error} />
      <TokenList tokens={hook.tokens} deleteToken={hook.deleteToken} />
    </div>
  );
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
  return (
    <div data-testid="token-list" className="mono text-[11px] text-(--color-faint) border border-dashed border-(--color-rule) px-4 py-6 rounded-sm text-center">
      no tokens yet · create one to wire up your first AI client
    </div>
  );
}
