// corpus-writing-retrieval-acl.spec.ts —— 迁移前 gap-fill (🟡#2)。
//
// writing 是三个可检索 genre 里**唯一从没进过 corpus_search/read 的**（它只在 crosslinks UI 测过）。
// #157 的 lister 覆盖 wiki/output/writing 三 genre + ACL 进 query，但 writing 那条路径零守卫。结构
// 迁移把 writing 迁进统一基座、estate 进 ACL query —— writing 的检索 + `writing://` glob 门必须继续对。
// 这条钉住：授 writing://** → 访客能检索到 writing；只授 wiki:// → 同一条 writing 被 ACL 拒。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'writingretr@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writingretr',
  fullName: 'Writing Retrieval Owner',
};
const WRITING_CODE = 'WRITING-GRANT';
const WIKIONLY_CODE = 'WIKI-ONLY';
const SLUG = 'retrieval-writing';
const PATH = 'writings/' + SLUG;
const KEY = 'writingretrqx';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('writing is retrievable + ACL-gated by writing:// glob', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'writing-retr-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'writing_create', {
      slug: SLUG, title: 'Retrieval Writing', excerpt: 'x',
      body_md: `an essay mentioning ${KEY}`, tags: [], publish: true,
    });
    const wRole = await createRole(request, csrf, {
      name: 'writing-role', description: 'writing://**', corpus_uris: ['writing://**'],
    });
    await createCode(request, csrf, { code: WRITING_CODE, label: 'w', assumed_role_id: wRole.id });
    const wikiRole = await createRole(request, csrf, {
      name: 'wiki-only-role', description: 'wiki://** only', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: WIKIONLY_CODE, label: 'k', assumed_role_id: wikiRole.id });
    await request.dispose();
  });

  test('writing://** granted → visitor can corpus_read + corpus_search the writing',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: WRITING_CODE, visitor_name: 'V',
      });
      const read = await corpusRead(request, sess, PATH);
      expect(read.error, 'writing read is allowed under writing://**').toBeUndefined();
      expect(read.body ?? '', 'read returns the writing body').toContain(KEY);
      expect(read.genre, 'resolves as a writing').toBe('writing');

      const hits = await search(request, sess, KEY);
      expect(hits.some((h) => h.path === PATH), 'writing surfaces in corpus_search').toBe(true);
      await request.dispose();
    });

  test('wiki:// only → the same writing is ACL-denied (out of scope)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: WIKIONLY_CODE, visitor_name: 'V',
    });
    const read = await corpusRead(request, sess, PATH);
    expect(read.error ?? '', 'writing denied when only wiki:// is granted').toContain('access denied');
    await request.dispose();
  });
});

interface ReadResult { body?: string; genre?: string; error?: string }

async function corpusRead(
  request: APIRequestContext, s: VisitorSession, path: string,
): Promise<ReadResult> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: ReadResult };
  return body.result ?? {};
}

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
