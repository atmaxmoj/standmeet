// mcp-show-grounding.spec.ts —— MCP `chat.show_grounding` debug tool。
//
// 用户故事：
//   owner 在 Claude / Cursor 里 chat.show_grounding(conversation_id="…")
//   → 看到 visitor 提问 / assistant 回复 + cited wiki + cited output 完整
//   body。owner 据此决定要不要再 promote / edit。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
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
  conversation_id: string;
  visitor_name: string;
  messages: { role: string; body: string; cited_output_ids: string[] }[];
  cited_outputs: { id: string; title: string; body: string }[];
}

test.describe.serial('MCP chat.show_grounding returns full transcript + cited bodies', () => {
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

  test('show_grounding returns assistant message + cited output title',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sid = await initMCP(request, token);
      const result = await callTool<GroundingPayload>(
        request, token, sid, 'chat.show_grounding',
        { conversation_id: convID },
      );
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.cited_outputs.some((o) => o.title === OUTPUT_TITLE)).toBeTruthy();
      await request.dispose();
    });
});

async function seedAndChat(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'owner-debug');
  const sid = await initMCP(request, apiToken);
  const raw = await callTool<{ raw_id: string }>(request, apiToken, sid, 'raw_dump', {
    body: 'rough', source: 'mcp:spec', tags: [],
  });
  const wiki = await callTool<{ wiki_id: string }>(request, apiToken, sid, 'promote_to_wiki', {
    raw_id: raw.raw_id, title: 'curated', tags: [],
  });
  await callTool<{ output_id: string }>(
    request, apiToken, sid, 'promote_wiki_to_output',
    { wiki_id: wiki.wiki_id, title: OUTPUT_TITLE, tags: [] },
  );
  await createCode(request, csrf, {
    code: CODE, label: 'intro', purpose: 'grounding debug',
  });
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
  });
  const stream = await sendMessage(request, sess, 'what do you think about polished essays');
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
  return rows[0].id;
}
