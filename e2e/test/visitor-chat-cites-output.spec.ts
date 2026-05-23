// visitor-chat-cites-output.spec.ts —— visitor 提问时 grounding 拉 output 层。
//
// 用户故事：
//   owner 把一条思考 promote 到 output 层（"可在对话里完整原样引用" 的成品）。
//   recruiter 拿 code 进来问问题；assistant 的 message 里 cited_output_ids
//   非空 —— 证明 output 真的进 grounding 了，不只是文件柜。
//
// 验证手段：mock provider 不 echo prompt，所以走 admin conversations
// transcript endpoint 直接看 assistant message.cited_output_ids 是否含 output id。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const RAW_BODY = 'local-first software is about owning your data, not offline.';
const WIKI_TITLE = 'Local-first ≠ offline';
const OUTPUT_TITLE = 'Local-first essay (polished)';
const CODE = 'INTRO-001';

test.describe.serial('visitor chat retrieval pulls output entries', () => {
  let outputID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const setup = await seedThreeTierCorpus(request);
    outputID = setup.outputID;
    await createCode(request, setup.csrf, {
      code: CODE, label: 'intro', purpose: 'visitor-output spec', included_tags: [],
    });
    await request.dispose();
  });

  test('assistant message cites the output entry on a visitor question',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
      });
      const stream = await sendMessage(request, sess, 'tell me about local-first');
      await stream.body();
      // 新 request context 没 session cookie：单独 login 一次拿 csrf。
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const cited = await fetchAssistantCitedOutputs(request, csrf, sess.conversation_id);
      expect(cited).toContain(outputID);
      await request.dispose();
    });
});

async function seedThreeTierCorpus(
  request: APIRequestContext,
): Promise<{ outputID: string; csrf: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'corpus-seeder');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ raw_id: string }>(request, token, sid, 'raw_dump', {
    body: RAW_BODY, source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ wiki_id: string }>(request, token, sid, 'promote_to_wiki', {
    raw_id: raw.raw_id, title: WIKI_TITLE, visibility: 'public', tags: [],
  });
  const out = await callTool<{ output_id: string }>(
    request, token, sid, 'promote_wiki_to_output',
    { wiki_id: wiki.wiki_id, title: OUTPUT_TITLE, visibility: 'public', tags: [] },
  );
  return { outputID: out.output_id, csrf };
}

async function fetchAssistantCitedOutputs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`get transcript failed: ${res.status()}`);
  const body = await res.json() as {
    messages: { role: string; cited_output_ids: string[] }[];
  };
  const assistant = body.messages.find((m) => m.role === 'assistant');
  return assistant?.cited_output_ids ?? [];
}
