// mcp-show-grounding.spec.ts —— MCP 上读一份逐字稿（conversations.get）。
//
// 用户故事：
//   owner 在 Claude / Cursor 里 conversations.get(conversation_id="…")
//   → 看到 visitor 提问 / assistant 回复 + 被引 wiki / output 的完整 body。
//   owner 据此决定要不要再 promote / edit。
//
// 这份载荷现在跟面板那份是同一个：被引条目在 wiki_refs / output_refs 里，
// 每条自带 body（以前 MCP 那份叫 cited_outputs，面板那份没有 body）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const OUTPUT_TITLE = 'Polished essay marker';
const CODE = 'INTRO-001';

interface GroundingPayload {
  conversation: { id: string; visitor_name: string };
  messages: { role: string; body: string; cited_output_ids: string[] }[];
  output_refs: { id: string; title: string; body: string }[];
}

test.describe('MCP conversations.get returns full transcript + cited bodies', () => {
  let token: string;
  let convID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    token = await seedAndChat(request);
    convID = await pickFirstConv(request);
    await request.dispose();
  });

  test('conversations.get returns assistant message + cited output title and body',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, token);
      const result = await callTool<GroundingPayload>(
        request, token, sid, 'conversations.get',
        { conversation_id: convID },
      );
      expect(result.messages.length).toBeGreaterThan(0);
      const cited = result.output_refs.find((o) => o.title === OUTPUT_TITLE);
      expect(cited, 'the cited output is in the transcript').toBeTruthy();
      expect(cited?.body ?? '', 'and it carries its body — that is what owner debugs with')
        .not.toBe('');
      await request.dispose();
    });
});

async function seedAndChat(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'owner-debug');
  const sid = await initMCP(request, apiToken);
  const raw = await callTool<{ id: string }>(request, apiToken, sid, 'corpus.create', {
    genre: 'raw', body: 'rough', source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ id: string }>(request, apiToken, sid, 'corpus.promote', {
    genre: 'raw', id: raw.id, title: 'curated', tags: [],
  });
  const out = await callTool<{ id: string; path: string }>(
    request, apiToken, sid, 'corpus.promote',
    { genre: 'wiki', id: wiki.id, title: OUTPUT_TITLE, tags: [] },
  );
  await createCode(request, csrf, {
    code: CODE, label: 'intro', purpose: 'grounding debug',
  });
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
  });
  // Mock is pure registration: register the corpus_read on the seeded output's
  // real (promote-returned) path — a corpus_read is what records the citation,
  // so show_grounding then surfaces this output as a cited body.
  const tag = await scriptMockToolCall(request, {
    name: 'corpus_read', args: { path: out.path },
  });
  const stream = await sendMessage(
    request, sess, `what do you think about polished essays${tag}`,
  );
  await stream.body();
  return apiToken;
}

interface ConvSummary { id: string; visitor_name: string }

async function pickFirstConv(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const res = await request.get(`${backend}/api/admin/conversations`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`list conversations: ${res.status()}`);
  const rows = (await res.json()) as ConvSummary[];
  const head = rows[0];
  if (!head) throw new Error('no conversations rows');
  return head.id;
}
