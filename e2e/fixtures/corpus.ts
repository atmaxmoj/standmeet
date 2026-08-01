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
  // 地址是树派生的(parent 链每段 slug 化的 title)。给了多段 path 如
  // 'projects/lucerna' 就先建出父节点链(title = 各段),让叶子的树路径重建成
  // 这个 path —— 这样 spec 的 path 断言 + ACL glob 不用改。leaf 仍写一份列 path
  // (admin transcript 暂时还取列;见 task #8 剩余面)。
  const parentID = await seedParentChain(request, apiToken, sessionId, opts.path);
  // mkdir -p 语义 at the leaf:同 parent 下已有同名 entry 就复用 —— 写时同 slug
  // 兄弟被后端拒(Obsidian 语义),同一个 describe 里多次 seed 同一篇不该撞。
  const existing = await findExistingChild(request, apiToken, sessionId, opts.title, parentID);
  if (existing !== '') return { rawID: '', wikiID: existing };
  const dump = await callTool<RawDumpResult>(
    request, apiToken, sessionId, 'raw_dump',
    { body: opts.body, source: 'mcp:e2e', tags: [] },
  );
  const args: Record<string, unknown> = {
    raw_id: dump.raw_id, title: opts.title,
  };
  if (opts.path) args['path'] = opts.path;
  if (parentID !== '') args['parent_id'] = parentID;
  if (opts.showAsSource === false) args['show_as_source'] = false;
  const promote = await callTool<PromoteWikiResult>(
    request, apiToken, sessionId, 'promote_to_wiki', args,
  );
  return { rawID: dump.raw_id, wikiID: promote.wiki_id };
}

// seedParentChain —— path 'a/b/leaf' → 建 a、b 两个父节点(title = 段),返回最
// 后一个父的 wiki_id(叶子挂它下面)。单段 / 无 path → 返 ''(叶子是 root)。
//
// mkdir -p 语义:某段父节点已存在(同 parent 下同名)就复用,不重建 —— 写时同
// slug 兄弟被后端拒(Obsidian 语义),不复用就会在共享前缀时撞名。
async function seedParentChain(
  request: APIRequestContext, apiToken: string, sessionId: string, path?: string,
): Promise<string> {
  const segments = (path ?? '').split('/').filter((s) => s !== '');
  let parentID = '';
  for (const seg of segments.slice(0, -1)) {
    const existing = await findExistingChild(request, apiToken, sessionId, seg, parentID);
    if (existing !== '') { parentID = existing; continue; }
    const dump = await callTool<RawDumpResult>(
      request, apiToken, sessionId, 'raw_dump',
      { body: seg, source: 'mcp:e2e', tags: [] },
    );
    const args: Record<string, unknown> = { raw_id: dump.raw_id, title: seg };
    if (parentID !== '') args['parent_id'] = parentID;
    const promote = await callTool<PromoteWikiResult>(
      request, apiToken, sessionId, 'promote_to_wiki', args,
    );
    parentID = promote.wiki_id;
  }
  return parentID;
}

interface WikiRow { id: string; title: string; parent_id: string | null }

// findExistingChild —— 在 parentID(''=root)下找 title 完全相同的现存节点,返回
// 其 id;没有返 ''。让 seedParentChain 复用父链而非重建撞名。
async function findExistingChild(
  request: APIRequestContext, apiToken: string, sessionId: string,
  title: string, parentID: string,
): Promise<string> {
  const rows = await callTool<WikiRow[]>(
    request, apiToken, sessionId, 'list_recent_wiki', { limit: 500 },
  );
  const wantParent = parentID === '' ? null : parentID;
  const hit = rows.find((r) => r.title === title && (r.parent_id ?? null) === wantParent);
  return hit?.id ?? '';
}

// publishEntry —— 把一条 corpus 条目设为公开（wiki / output 同一个 op，genre 是参数）。
//
// 九个 spec 各自抄了一份这段调用，于是 tool 一改名就要改九处。一处调用，一处改。
export async function publishEntry(
  request: APIRequestContext,
  apiToken: string,
  sessionId: string,
  opts: { genre: 'wiki' | 'output'; id: string; excerpt?: string },
): Promise<void> {
  await callTool<unknown>(request, apiToken, sessionId, 'seo.set_entry_seo', {
    genre: opts.genre, id: opts.id, excerpt: opts.excerpt ?? '', published: true,
  });
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
