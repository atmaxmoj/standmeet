// security-idor-report.spec.ts —— pentest / BOLA fix (RED-first)。GET /report/{id} 原本只按
// owner_id 鉴权(fetchOwnedReport),单 owner 实例下所有访客同 owner → 访客 Bob 能用自己的 token
// 读到访客 Alice 的对话摘要报告(跨访客 BOLA)。契约:report 必须 scope 到**创建它的会话的
// member**,Bob 读 Alice 的 report → 404。绿=归属门在;红(修复前)=Bob 读到 Alice 的报告。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const ALICE_SECRET_HTML = '<h1>Alice private recap: layoff plans Q3</h1>';

async function summarizeAndGetReportID(
  request: APIRequestContext, sess: VisitorSession,
): Promise<string> {
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, ALICE_SECRET_HTML);
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { system: 'You are alice.', user_message: `recap please${toolTag}${replyTag}`, conversation_id: sess.conversation_id },
  });
  expect(res.status()).toBe(200);
  const sse = await res.text();
  const m = sse.match(/\\"report_id\\":\\"([0-9a-f-]{36})\\"/) ?? sse.match(/"report_id":"([0-9a-f-]{36})"/);
  return m?.[1] ?? '';
}

async function readReport(
  request: APIRequestContext, token: string, reportID: string,
): Promise<{ status: number; body: string }> {
  const res = await request.get(`${BACKEND}/api/v1/report/${reportID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: await res.text() };
}

test.describe('pentest · cross-visitor report BOLA', () => {
  let seed: BaseSeed;
  let alice: VisitorSession;
  let bob: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const code = await createCode(seed.request, seed.csrf, {
      code: 'IDOR-RPT1', label: 'idorrpt', max_members: 5,
    });
    alice = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'AliceRpt',
    });
    bob = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'BobRpt',
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('Bob cannot read Alice\'s summarize report by id (own token, foreign report)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const reportID = await summarizeAndGetReportID(request, alice);
      expect(reportID, 'Alice produced a report').toBeTruthy();

      // sanity: Alice reads her own report.
      const own = await readReport(request, alice.session_token, reportID);
      expect(own.status, 'Alice reads her own report').toBe(200);
      expect(own.body).toContain('Alice private recap');

      // BOLA: Bob (same owner, different member) must NOT read Alice's report.
      const bola = await readReport(request, bob.session_token, reportID);
      expect(bola.status, 'Bob is denied Alice\'s report').toBe(404);
      expect(bola.body, 'no Alice content bleeds to Bob').not.toContain('Alice private recap');
      await request.dispose();
    });
});
