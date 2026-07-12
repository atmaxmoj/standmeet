// visitor-chat-cites-writing.spec.ts —— writing 读了也进 chat 引用(跟 wiki/output 同待遇)。
//
// 用户故事:owner writing_create 一篇 published writing;visitor 问 → AI corpus_read
// 它 → assistant message 的 cited_writing_ids 含该 writing(footer 会展示)。writing 是
// 公开内容(published),读了就 cite,无 show_as_source gate。
//
// RED-first:cited_writing_ids 这条管道原本不存在(routeCitation 把 writing 丢弃),先红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'writecite@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writecite',
  fullName: 'Write Cite',
};

const SLUG = 'local-first-manifesto';
const WRITING_PATH = `writings/${SLUG}`;
const CODE = 'WRITE-001';

test.describe('visitor chat cites writing entries', () => {
  let writingID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'writecite-seed');
    const sid = await initMCP(request, token);
    const w = await callTool<{ writing_id: string }>(request, token, sid, 'writing_create', {
      slug: SLUG, title: 'Local-first manifesto', excerpt: 'owning your data',
      body_md: 'local-first software is about owning your data, not offline.',
      tags: [], publish: true,
    });
    writingID = w.writing_id;
    const role = await createRole(request, csrf, {
      name: 'writing-role', description: 'writing://**', corpus_uris: ['writing://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'w', assumed_role_id: role.id });
    await request.dispose();
  });

  test('assistant message cites the writing entry on a visitor question',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
      });
      // AI reads the published writing by its path; a corpus_read of a writing
      // must record a citation the same as wiki/output.
      const tag = await scriptMockToolCall(request, {
        name: 'corpus_read', args: { path: WRITING_PATH },
      });
      const stream = await sendMessage(request, sess, `tell me about local-first${tag}`);
      await stream.body();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const cited = await fetchCitedWritings(request, csrf, sess.conversation_id);
      expect(cited).toContain(writingID);
      await request.dispose();
    });
});

// fetchCitedWritings —— assistant message 的 cited_writing_ids(transcript API)。
async function fetchCitedWritings(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as {
    messages: Array<{ role: string; cited_writing_ids?: string[] }>;
  };
  const assistant = body.messages.find((m) => m.role === 'assistant');
  return assistant?.cited_writing_ids ?? [];
}
