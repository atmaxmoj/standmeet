// visitor-summary.spec.ts —— POST /api/v1/sessions/{id}/summary。
//
// 用户故事：
//   recruiter 跟 owner 的 AI 聊完，按 "generate report" 按钮 → AI 用
//   Conversation Report skill prompt 生成 markdown → recruiter 看到 ##
//   Overview / Key Topics / Takeaways；conversation ended，再发消息 410。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

test.describe.serial('visitor POST /summary 生成对话报告 + 结束 session', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'summary-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'summary spec',
    });
    await request.dispose();
  });

  test('chat → POST /summary → markdown returned + next message rejected', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
    });
    const stream = await sendMessage(request, sess, 'tell me about lucerna');
    await stream.body();

    const md = await postSummary(request, sess);
    expect(md.length).toBeGreaterThan(0);

    // ended 后再发消息 → 410 conversation_ended
    const next = await sendMessage(request, sess, 'one more question');
    expect(next.status()).toBe(410);
    await request.dispose();
  });
});

async function postSummary(
  request: APIRequestContext,
  sess: { conversation_id: string; session_token: string },
): Promise<string> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/summary`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } },
  );
  if (res.status() !== 200) throw new Error(`summary failed: ${res.status()}`);
  const body = await res.json() as { summary_md: string };
  return body.summary_md;
}
