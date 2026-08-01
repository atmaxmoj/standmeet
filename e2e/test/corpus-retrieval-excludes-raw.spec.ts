// corpus-retrieval-excludes-raw.spec.ts —— 迁移前 gap-fill (🟡#1)。
//
// raw 从不进访客检索 —— 今天只有 iam-role-raw-deny 从 **LLM 引用**路径证明(cites==0)。缺一个
// 直接对 lister(corpus_search)的断言:即使 role **贪婪地**把 raw://** 也授上,corpus_search 也
// 不返回 raw。结构迁移后 raw 留独立 inbox 表、genre 维度进 query —— 若 genre 过滤漏了,raw 可能
// 意外被扫进检索。这条钉住 lister 层的 raw 排除(独立于 LLM 路径)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'excluderaw@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'excluderaw',
  fullName: 'Exclude Raw Owner',
};
const CODE = 'EXCLUDERAW-1';
const RAW_KEY = 'rawonlyqx';
const WIKI_KEY = 'wikionlyqx';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('retrieval excludes raw even when the role greedily grants raw://**', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'exclude-raw-seed');
    const sid = await initMCP(request, token);
    // A raw entry (never promoted) + a wiki entry — each with a unique keyword.
    await callTool(request, token, sid, 'corpus.create',
      { genre: 'raw', body: `private raw thought about ${RAW_KEY}`,
        source: 'mcp:e2e', tags: [] });
    await seedWiki(request, token, sid, { title: 'Public Wiki', body: `note about ${WIKI_KEY}` });
    // GREEDY role: grants raw://** (which is hardcode-denied) + wiki://**.
    const role = await createRole(request, csrf, {
      name: 'greedy-raw-role', description: 'grants raw://** + wiki://**',
      corpus_uris: ['raw://**', 'wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'greedy', assumed_role_id: role.id });
    await request.dispose();
  });

  test('corpus_search never returns a raw entry (positive control: it does find the wiki)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });

      // The raw keyword surfaces nothing — raw is not scanned by the lister.
      const rawHits = await search(request, sess, RAW_KEY);
      expect(rawHits.length, 'raw entry never appears in corpus_search, despite raw://** granted')
        .toBe(0);

      // Positive control: the wiki keyword DOES surface (proves search works, raw is the exclusion).
      const wikiHits = await search(request, sess, WIKI_KEY);
      expect(wikiHits.some((h) => h.title === 'Public Wiki'), 'the wiki entry is found').toBe(true);
      await request.dispose();
    });
});

async function search(
  request: APIRequestContext, s: VisitorSession, query: string,
): Promise<Array<{ path?: string; title?: string }>> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_search`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { query } },
  );
  const body = await res.json() as { result?: Array<{ path?: string; title?: string }> };
  return body.result ?? [];
}
