// visitor-chat-permissions-deny.spec.ts —— A.3-IAM-5 起 ACL 是正向白名单
// (RoleSnapshot.CorpusURIs 命中即 allow，不在列表 = deny)。
//
// 用户故事：
//   owner 给 recruiter 发 INTRO 代码挂 role "recruiter-only"。role 配
//   corpus_uris = ['wiki://projects/**']，允许 projects/lucerna 但不允许
//   personal/family。recruiter 入境后问 family，AI corpus_search
//   拿不到 personal/family，corpus_read 也会被拒。最终 cited 不
//   含 personal/family。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'RECRUITER-001';
const ALLOWED = 'projects/lucerna';
const DENIED = 'personal/family';

test.describe('positive-list URI ACL excludes paths not in role.corpus_uris', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedTwoWikis(request);
    const role = await createRole(request, csrf, {
      name: 'recruiter-only', description: 'projects/** visible only',
      corpus_uris: ['wiki://projects/**', 'output://**', 'writing://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'recruiter', purpose: 'positive-list ACL spec',
      assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('path outside role.corpus_uris never appears in cited refs', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
    });
    const stream = await sendMessage(request, sess, 'tell me about your family');
    await stream.body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const paths = await fetchCitedPaths(request, csrf, sess.conversation_id);
    expect(paths).not.toContain(DENIED);
    await request.dispose();
  });
});

async function seedTwoWikis(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'permissions-deny-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'my mother is from singapore.', title: 'Family', path: DENIED,
  });
  await seedWiki(request, token, sid, {
    body: 'lucerna is the project I am proudest of.',
    title: 'Lucerna', path: ALLOWED,
  });
  return csrf;
}

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[]; cited_output_ids: string[] }>;
  wiki_refs: CitedRefView[];
  output_refs: CitedRefView[];
}

async function fetchCitedPaths(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const ids = new Set([
    ...(assistant?.cited_wiki_ids ?? []),
    ...(assistant?.cited_output_ids ?? []),
  ]);
  const all = [...body.wiki_refs, ...body.output_refs];
  return all.filter((r) => ids.has(r.id)).map((r) => r.path);
}
