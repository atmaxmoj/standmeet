// visitor-summarize-conversation.spec.ts —— I.3: AI 调
// summarize_conversation tool → 浏览器渲 ReportArtifact 卡 + 独立
// /report/[id] 路由 + 老 /summary endpoint 已删 (410 / 404 等价的
// route mismatch)。
//
// 用户故事:
//   1. visitor 持 code 进 chat → 来一 turn 聊点话
//   2. AI (mock) 调 summarize_conversation → backend 生成 HTML 报告
//      落 chat_reports → tool_result {ok, report_id, html} 推浏览器
//   3. ConversationDeck 渲一张 ReportArtifactCard，含 iframe (srcDoc=html)
//      + "open as page" 链接
//   4. visitor 点链接 → /report/[id] 独立页 → fetch /api/v1/report/[id]
//      → iframe 渲完整 HTML
//   5. 老 POST /api/v1/sessions/{id}/summary 已删 → 404

import { readFileSync } from 'node:fs';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto, enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'summary-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sumowner',
  fullName: 'Summary Owner',
};

const CODE = 'SUM-001';

// REPORT_HTML —— mock provider 在 summarize_conversation 调完之后吐这段
// HTML 当 LLM 输出。runSummarize 会把 LLM 返回 (Generate 的 string) 当
// HTML body 入库 + echo wire。
const REPORT_HTML = [
  '<h1>Quick recap</h1>',
  '<h2>Overview</h2><p>Visitor and assistant discussed weekend hike plans.</p>',
  '<h2>Key Topics</h2><ul><li>Trail picks</li><li>Gear list</li></ul>',
].join('');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor summarize_conversation · I.3', () => {
  test('AI tool call → ReportArtifactCard inline + /report/[id] 独立路由',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'summarize_conversation', args: {},
      });
      // tool 后 LLM 又被调一次出 HTML 当报告内容；mock 走 next_reply。
      await scriptMockReplyText(request, REPORT_HTML);
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'summarize what we discussed');

      // ReportArtifactCard 在 chat 流里渲；iframe srcDoc 含报告 HTML。
      const card = page.getByTestId('tool-card-summarize_conversation');
      await expect(card, 'ReportArtifactCard rendered')
        .toBeVisible({ timeout: 10_000 });
      const reportID = await card.getAttribute('data-report-id');
      expect(reportID, 'report id 透到 card data attribute').toBeTruthy();

      // 点 open as page → 新 tab 走 /report/[id]
      const openLink = card.getByTestId('report-open-link');
      await expect(openLink).toHaveAttribute('href', `/report/${reportID}`);
    });

  test('GET /api/v1/report/[id] 返 owner-scoped 报告 row',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // issue session first so agent_turn has a valid conversation_id
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      // queue tool + reply AFTER session issue (avoid races where any
      // prior mock state from beforeAll consumed our queue)
      await scriptMockToolCall(request, {
        name: 'summarize_conversation', args: {},
      });
      await scriptMockReplyText(request, REPORT_HTML);
      const turnRes = await postAgentTurn(request, sess);
      const reportID = extractReportID(turnRes);
      expect(reportID, `report_id should be in SSE; got body:\n${turnRes}`)
        .toBeTruthy();

      // 用同 session token 读 /report/{id}
      const r = await request.get(`${BACKEND}/api/v1/report/${reportID}`, {
        headers: { Authorization: `Bearer ${sess.session_token}` },
      });
      expect(r.status()).toBe(200);
      const body = await r.json() as { html: string };
      expect(body.html).toContain('<h1>Quick recap</h1>');
      await request.dispose();
    });

  test('GET /api/v1/report/[id]/pdf 返 application/pdf (真 gotenberg 渲染)',
    async ({ playwright }) => { await reportPDFRouteTest(playwright); });

  test('/report/[id] 上 download PDF 按钮 → 下载一份 PDF',
    async ({ page, playwright }) => { await reportPDFDownloadUITest(page, playwright); });

  test('/report/[id] iframe 套了 StandMeet 设计语言（不是裸 Times）',
    async ({ page, playwright }) => { await reportStyledTest(page, playwright); });

  test('老 POST /api/v1/sessions/{id}/summary 已删 → 404',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const res = await request.post(
        `${BACKEND}/api/v1/sessions/${sess.conversation_id}/summary`,
        {
          headers: { Authorization: `Bearer ${sess.session_token}` },
          data: {},
        },
      );
      expect(res.status()).toBe(404);
      await request.dispose();
    });
});

// reportPDFRouteTest —— create a report then hit /report/{id}/pdf; assert it's
// a real PDF rendered by gotenberg (magic bytes + attachment headers).
async function reportPDFRouteTest(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  await scriptMockReplyText(request, REPORT_HTML);
  const reportID = extractReportID(await postAgentTurn(request, sess));
  expect(reportID, 'report_id in SSE').toBeTruthy();

  const r = await request.get(`${BACKEND}/api/v1/report/${reportID}/pdf`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  expect(r.status(), 'pdf route 200').toBe(200);
  expect(r.headers()['content-type']).toContain('application/pdf');
  expect(r.headers()['content-disposition']).toContain('attachment');
  expect((await r.body()).subarray(0, 5).toString(), 'PDF magic bytes').toBe('%PDF-');
  await request.dispose();
}

// reportPDFDownloadUITest —— create a report via chat, open /report/[id], click
// download PDF, assert a real .pdf file downloads.
async function reportPDFDownloadUITest(page: Page, playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  await scriptMockReplyText(request, REPORT_HTML);
  await request.dispose();

  await enterChatWithCode(page);
  await fireFirstTurn(page, 'summarize what we discussed');
  const card = page.getByTestId('tool-card-summarize_conversation');
  await expect(card).toBeVisible({ timeout: 10_000 });
  const reportID = await card.getAttribute('data-report-id');
  expect(reportID).toBeTruthy();

  await goto(page, `/report/${reportID}`);
  const dlBtn = page.getByTestId('report-download-pdf');
  await expect(dlBtn).toBeEnabled({ timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dlBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^report-.*\.pdf$/);
  const head = readFileSync(await download.path()).subarray(0, 5).toString();
  expect(head, 'downloaded file is a PDF').toBe('%PDF-');
}

// reportStyledTest —— the AI report HTML is a bare fragment (no CSS); the page
// must wrap it in the StandMeet design language. Guard against regressing to the
// raw browser-default Times render: the iframe document must carry the serif
// body font + vermillion accent, and the body's computed font must be Newsreader
// (not the default serif/Times).
async function reportStyledTest(page: Page, playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  await scriptMockReplyText(request, REPORT_HTML);
  await request.dispose();

  await enterChatWithCode(page);
  await fireFirstTurn(page, 'summarize what we discussed');
  const card = page.getByTestId('tool-card-summarize_conversation');
  await expect(card).toBeVisible({ timeout: 10_000 });
  const reportID = await card.getAttribute('data-report-id');
  expect(reportID).toBeTruthy();

  await goto(page, `/report/${reportID}`);
  const frame = page.getByTestId('report-iframe');
  const srcdoc = await frame.getAttribute('srcdoc');
  expect(srcdoc, 'report iframe wraps the fragment in a styled document').toBeTruthy();
  expect(srcdoc, 'serif design font declared').toContain('Newsreader');
  expect(srcdoc, 'vermillion accent declared').toContain('#B5391C');
  expect(srcdoc, 'still contains the report body').toContain('<h1>Quick recap</h1>');

  // computed font on the rendered body is the design serif, not default Times.
  const fontFamily = await page.frameLocator('[data-testid="report-iframe"]')
    .locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily.toLowerCase(), 'body renders in Newsreader').toContain('newsreader');
}

async function postAgentTurn(
  request: APIRequestContext,
  sess: { session_token: string; conversation_id: string },
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    // conversation_id 必填：tool 内部 INSERT chat_reports 走这个 FK
    data: {
      system: 'You are alice.',
      user_message: 'recap please',
      conversation_id: sess.conversation_id,
    },
  });
  expect(res.status()).toBe(200);
  return await res.text();
}

function extractReportID(sse: string): string {
  // SSE 帧 data:{...result: "<string>"}；string 是 JSON 形态的 tool
  // result，所以是 escaped 双引号。两个形态都尝试。
  const escaped = sse.match(/\\"report_id\\":\\"([0-9a-f-]{36})\\"/);
  if (escaped !== null) return escaped[1] ?? '';
  const plain = sse.match(/"report_id":"([0-9a-f-]{36})"/);
  return plain === null ? '' : plain[1] ?? '';
}

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await dismissNamePicker(page);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function dismissNamePicker(page: Page): Promise<void> {
  const skipBtn = page.getByRole('button', { name: /skip/i });
  const visible = await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  visible && await skipBtn.click();
}

async function fireFirstTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'sum-role', description: 'summarize spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'sum', assumed_role_id: role.id,
  });
  await request.dispose();
}
