// corpus-promotion-linkage.spec.ts —— 迁移前 gap-fill (🔴#3)。
//
// 提升链 raw→wiki→output 的**归属图**(wiki.source_raw_ids / output.source_wiki_ids)此前**零直接
// 断言** —— 每个 promotion 测试只验「目标标题出现在列表/landing」,从没验过 source 链本身。结构迁移
// 把三个 genre 迁进统一基座,这个跨行的归属图最容易在搬运中丢/错。这条钉住:提升后 source id 真的
// 指回上游那条。migration 必须保住它。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'promolink@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'promolink',
  fullName: 'Promotion Linkage Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus promotion linkage: raw→wiki→output source ids point upstream', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('promoting raw→wiki→output records source_raw_ids / source_wiki_ids back to the source rows',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'promo-linkage');
      const sid = await initMCP(request, token);

      const raw = await callTool<{ id: string }>(
        request, token, sid, 'corpus.create',
        { genre: 'raw', body: 'source thought for promotion linkage',
          source: 'mcp:e2e', tags: [] });
      const wiki = await callTool<{ id: string }>(
        request, token, sid, 'corpus.promote',
        { genre: 'raw', id: raw.id, title: 'Linked Wiki' });
      const output = await callTool<{ id: string }>(
        request, token, sid, 'corpus.promote',
        { genre: 'wiki', id: wiki.id, title: 'Linked Output' });

      // wiki.source_raw_ids → the raw it came from.
      const wikiDetail = await getDetail(request, 'wiki', wiki.id);
      expect(wikiDetail.source_raw_ids, 'wiki records the raw it was promoted from')
        .toContain(raw.id);

      // output.source_wiki_ids → the wiki it came from.
      const outDetail = await getDetail(request, 'output', output.id);
      expect(outDetail.source_wiki_ids, 'output records the wiki it was promoted from')
        .toContain(wiki.id);

      await request.dispose();
    });
});

interface CorpusDetail { source_raw_ids?: string[]; source_wiki_ids?: string[] }

async function getDetail(
  request: APIRequestContext, genre: 'wiki' | 'output', id: string,
): Promise<CorpusDetail> {
  const res = await request.get(`${BACKEND}/api/admin/corpus/${genre}/${id}`);
  if (!res.ok()) throw new Error(`get ${genre} detail failed: ${res.status()}`);
  return await res.json() as CorpusDetail;
}
