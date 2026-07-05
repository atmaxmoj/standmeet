// corpus-facade-lister.spec.ts —— 迁移前 gap-fill (🔴#2)。
//
// 今天有**两个平行的跨-genre 层**在同一批 corpus 表上:
//   - postgres.Corpus facade（按 **id** 寻址）—— dialog 引用反查用（cited_wiki_ids → title+path）。
//   - usecases.CorpusLister #157（按 **path** 寻址）—— corpus_search/read/list 检索用。
// 结构迁移要把这两层**合并成一个**。合并的头号风险 = 同一条 entry 在两层下的 path / 身份**不一致**。
// 此前两层各自测、从无交叉断言。这条钉住:一条被 dialog 引用的 entry（facade 反查出的 path/title）
// 跟 corpus_read 按那个 path 读到的（lister）**指向同一条**。合并实现必须让它继续绿。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { issueSession, sendMessage, type VisitorSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'facadelister@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'facadelister',
  fullName: 'Facade Lister Owner',
};
const CODE = 'FACADE-1';
const KEYWORD = 'consistencyqx';
const TARGET_PATH = 'consistency/facade-target';
const TARGET_TITLE = 'Facade Target';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[] }>;
  wiki_refs: CitedRefView[];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('corpus facade (id) ↔ lister (path) resolve the same entry consistently', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'facade-lister-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: TARGET_TITLE, body: `Detail about ${KEYWORD}.`, path: TARGET_PATH,
    });
    await createCode(request, csrf, { code: CODE, label: 'facade' });
    await request.dispose();
  });

  test('a dialog-cited entry (facade view) matches what corpus_read resolves at that path (lister view)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      // Agent turn: mock LLM does default corpus_search → corpus_read → cite for the keyword.
      await sendMessage(request, sess, `tell me about ${KEYWORD}`);

      // FACADE view: the citation reverse-lookup resolves cited_wiki_ids → {id, title, path}.
      // Owner-authed transcript → fresh login on this context (sets the auth cookie + csrf).
      const owner = await playwright.request.newContext();
      const { csrf } = await loginAPI(owner, OWNER.email, OWNER.password);
      const cited = await fetchCitedRefs(owner, csrf, sess.conversation_id);
      expect(cited.length, 'the target entry was cited').toBeGreaterThan(0);
      const ref = cited[0]!;
      expect(ref.path, 'facade reports the entry at its real derived path').toBe(TARGET_PATH);
      expect(ref.title, 'facade reports the entry title').toBe(TARGET_TITLE);

      // LISTER view: corpus_read at that same facade-reported path resolves to the SAME entry.
      const body = await visitorRead(request, sess, ref.path);
      expect(body, 'lister resolves the facade path to the same entry body').toContain(KEYWORD);
      await owner.dispose();
      await request.dispose();
    });
});

async function fetchCitedRefs(
  request: APIRequestContext, csrfTok: string, conversationID: string,
): Promise<CitedRefView[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrfTok },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const citedIDs = new Set(assistant?.cited_wiki_ids ?? []);
  return body.wiki_refs.filter((r) => citedIDs.has(r.id));
}

async function visitorRead(
  request: APIRequestContext, s: VisitorSession, path: string,
): Promise<string> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${s.conversation_id}/tools/corpus_read`,
    { headers: { Authorization: `Bearer ${s.session_token}` }, data: { path } },
  );
  const body = await res.json() as { result?: { body?: string; error?: string } };
  if (body.result?.error !== undefined) throw new Error(body.result.error);
  return body.result?.body ?? '';
}
