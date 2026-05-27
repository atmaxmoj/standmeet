// visitor-chat-byoai-public-only.spec.ts —— BYOAI tier 默认只能访问
// `public/**` 路径，其他 path 一律 deny —— owner 给 BYOAI 的兜底准入策略
// （没 invite code 的访客，不该看到默认 corpus）。
//
// 用户故事：
//   visitor 没邀请码，但有自己 Anthropic key，走 BYOAI panel 进 chat。
//   owner 种了 public/intro (开放) + personal/secrets (私有) 两条 wiki。
//   visitor 问"tell me about your secrets" —— AI 即便想 search/read，
//   personal/secrets 永远不会出现在 search 结果，read 也会被拒。
//   cited 只含 public/intro（被 AI 间接 read 到的话），绝不含 personal/secrets。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueByoaiSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const FAKE_KEY = 'sk-ant-fake-test-key-for-byoai-flow';
const PUBLIC = 'public/intro';
const PRIVATE = 'personal/secrets';

test.describe('BYOAI tier locked to public/** path glob', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedPublicAndPrivate(request);
    await request.dispose();
  });

  test('BYOAI visitor cannot reach personal/** even when asking about it', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueByoaiSession(request, {
      handle: OWNER.handle, byoai_provider: 'anthropic', byoai_key: FAKE_KEY,
      byoai_endpoint: 'https://api.anthropic.com',
      byoai_model: 'claude-haiku-4-5-20251001',
      visitor_name: 'Curious',
    });
    const stream = await sendMessage(request, sess, 'tell me about your secrets');
    await stream.body();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const paths = await fetchCitedPaths(request, csrf, sess.conversation_id);
    expect(paths).not.toContain(PRIVATE);
    await request.dispose();
  });
});

async function seedPublicAndPrivate(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'byoai-scope-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'alice is a software engineer in toronto.',
    title: 'Public intro', path: PUBLIC,
  });
  await seedWiki(request, token, sid, {
    body: 'salary, debts, addresses —— private context.',
    title: 'Secrets', path: PRIVATE,
  });
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
  return [...body.wiki_refs, ...body.output_refs]
    .filter((r) => ids.has(r.id)).map((r) => r.path);
}
