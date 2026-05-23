// corpus.ts —— MCP raw_dump → promote_to_wiki / promote_wiki_to_output 的
// 合成 helper（spec 用作 fixture，让 retrieval agent 有内容可搜）。
//
// 重设后字段：
//   • path —— 唯一标识 (取代 seo_slug)。retrieval ACL 按 path-glob 评估。
//   • show_as_source —— false 时 AI 可读但不计入 cited footer。
//   • visibility 字段被砍 —— 准入靠 corpus_permissions 在 access code 上。

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

interface RawDumpResult { raw_id: string }
interface PromoteWikiResult { wiki_id: string }

export interface SeedWikiOpts {
  body: string;
  title: string;
  path?: string;
  showAsSource?: boolean;
}

export async function seedWiki(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: SeedWikiOpts,
): Promise<{ rawID: string; wikiID: string }> {
  const dump = await callTool<RawDumpResult>(
    request, apiToken, sessionId, 'raw_dump',
    { body: opts.body, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = {
    raw_id: dump.raw_id, title: opts.title,
  };
  if (opts.path) args['path'] = opts.path;
  if (opts.showAsSource === false) args['show_as_source'] = false;
  const promote = await callTool<PromoteWikiResult>(
    request, apiToken, sessionId, 'promote_to_wiki', args,
  );
  return { rawID: dump.raw_id, wikiID: promote.wiki_id };
}

// seedPublicWiki —— 老 spec 入口；retrieval-redesign 之后 path 字段是主要
// 标识，旧 spec 调用方暂时无 path 入参，让此 helper 自动用 wiki/<random>
// path（重设后 backend 也会同样 derive）。tags 字段保留入参但 ignore ——
// retrieval ACL 走 path-glob，tag 准入不再起作用。
//
// 完成 [[path-rename-migration]] 后 owner 可以再扫一遍这些 callers
// 改成显式调用 seedWiki + path 参数。
export async function seedPublicWiki(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: { body: string; title: string; tags?: string[] },
): Promise<{ rawID: string; wikiID: string }> {
  return seedWiki(request, apiToken, sessionId, {
    body: opts.body, title: opts.title,
  });
}
