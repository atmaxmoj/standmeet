// corpus.ts —— MCP raw_dump → promote_to_wiki 的合成 helper（spec 用作
// 测试夹具，让 RAG 有 public 内容可引用）。

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

interface RawDumpResult { raw_id: string }
interface PromoteWikiResult { wiki_id: string }

export async function seedPublicWiki(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: { body: string; title: string; tags: string[] },
): Promise<{ rawID: string; wikiID: string }> {
  const dump = await callTool<RawDumpResult>(
    request, apiToken, sessionId, 'raw_dump',
    { body: opts.body, source: 'mcp:e2e', tags: opts.tags },
  );
  const promote = await callTool<PromoteWikiResult>(
    request, apiToken, sessionId, 'promote_to_wiki',
    { raw_id: dump.raw_id, title: opts.title, visibility: 'public' },
  );
  return { rawID: dump.raw_id, wikiID: promote.wiki_id };
}
