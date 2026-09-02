// corpus-promotion-linkage.spec.ts — pre-migration gap-fill (🔴#3).
//
// The promotion chain raw→wiki→output's **lineage graph**
// (wiki.source_raw_ids / output.source_wiki_ids) previously had **zero direct
// assertions** — every promotion test only checked that "the target title appears in
// the list/landing", never checked the source chain itself. The structural migration
// moves all three genres onto a unified base, and this cross-row lineage graph is the
// thing most likely to get lost or broken in the move. This case pins down: after
// promotion, the source id really does point back to the upstream one. The migration
// must preserve it.

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
