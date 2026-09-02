// visitor-summarize-conversation.spec.ts — I.3: the AI calls the
// summarize_conversation tool → the browser renders a ReportArtifact card + a
// standalone /report/[id] route + the old /summary endpoint is removed (a 410/404 is
// an equally valid route mismatch).
//
// User story:
//   1. the visitor enters chat holding a code → has one turn of conversation
//   2. the AI (mock) calls summarize_conversation → the backend generates an HTML
//      report, persists it into chat_reports → pushes tool_result {ok, report_id,
//      html} to the browser
//   3. ConversationDeck renders a ReportArtifactCard, containing an iframe
//      (srcDoc=html) + an "open as page" link
//   4. the visitor clicks the link → the standalone /report/[id] page → fetches
//      /api/v1/report/[id] → the iframe renders the full HTML
//   5. the old POST /api/v1/sessions/{id}/summary is removed → 404

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

// reportCardInFrame — the summarize card is now a ui:// sandbox iframe served by the
// summarize plugin; the card's content (tool-card-summarize_conversation +
// report-open-link) lives inside the frame, fetched via frameLocator.
function reportCardInFrame(page: Page) {
  return page
    .frameLocator('[data-testid="mcp-app-card-summarize_conversation"]')
    .getByTestId('tool-card-summarize_conversation');
}

const OWNER = {
  email: 'summary-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sumowner',
  fullName: 'Summary Owner',
};

const CODE = 'SUM-001';

// REPORT_HTML — the mock provider spits out this HTML as the LLM's output once
// summarize_conversation is called. runSummarize takes the LLM's return value
// (Generate's string) as the HTML body, persists it, and echoes it over the wire.
const REPORT_HTML = [
  '<h1>Quick recap</h1>',
  '<h2>Overview</h2><p>Visitor and assistant discussed weekend hike plans.</p>',
  '<h2>Key Topics</h2><ul><li>Trail picks</li><li>Gear list</li></ul>',
].join('');

// REPORT_HTML_REVISED — #129's revised version from the second summarize call,
// carrying its own unique marker so an assertion can confirm "the original row was
// rewritten".
const REPORT_HTML_REVISED = [
  '<h1>Quick recap</h1>',
  '<h2>Overview</h2><p>REVISED weekend plan: switched to a coastal walk.</p>',
].join('');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor summarize_conversation · I.3', () => {
  test('AI tool call → ReportArtifactCard inline + /report/[id] 独立路由',
    async ({ page, playwright }) => { await reportInlineCardTest(page, playwright); });

  test('GET /api/v1/report/[id] 返 owner-scoped 报告 row (已是完整 styled doc)',
    async ({ playwright }) => { await reportRowIsStyledDocTest(playwright); });

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

  // #129: one report per conversation — a second summarize revises the original
  // report, it does not append a second one. report_id must stay stable (the same row
  // gets rewritten), otherwise the old /report/[id] link breaks + the owner sees
  // duplicate reports.
  test('summary 一会话一份 —— 第二次 summarize revise 原 report,report_id 稳定 (#129)',
    async ({ playwright }) => { await summaryReviseInPlaceTest(playwright); });

  // F-A-19: the summarize dialog must PERSIST so it survives a reload/restore. summarize is
  // return_directly — the turn ends on the tool result with NO model answer text, so the old
  // "persist iff answered()" rule dropped the whole dialog and the visitor lost the report they
  // generated after a reload. Drive the real persist path: run a summarize turn, then GET the
  // conversation aggregate (the restore source) and assert the summarize dialog is there.
  // RED before the fix: the conversation has 0 dialogs carrying summarize_conversation.
  test('summarize dialog persists so it survives a reload (F-A-19)',
    async ({ playwright }) => { await summarizePersistsTest(playwright); });

  // Generating a summary does not end the conversation: the same conversation can
  // still send a turn after summarizing.
  // (The old model's /summary wrote ended_at → the next turn's quota preflight
  //  flipped ErrChatEnded → 410. That's gone; this guards "summary is only an
  //  artifact, it never seals the conversation." postAgentTurn already asserts 200
  //  internally, so if the second turn is blocked it fails outright.)
  test('summary 不结束对话 —— 同一会话之后还能继续发 turn',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'V',
      });
      const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
      const replyTag = await scriptMockReplyText(request, REPORT_HTML);
      expect(extractReportID(await postAgentTurn(request, sess, `${toolTag}${replyTag}`)), 'summary produced')
        .toBeTruthy();

      // Send another turn on the same conversation → must be 200 + answered normally
      // (not blocked as ended).
      const reply2Tag = await scriptMockReplyText(request, 'Sure, happy to keep going.');
      const sse = await postAgentTurn(request, sess, reply2Tag);
      expect(sse, 'follow-up answered — conversation not ended')
        .toContain('Sure, happy to keep going');
      await request.dispose();
    });
});

// reportPDFRouteTest —— create a report then hit /report/{id}/pdf; assert it's
// a real PDF rendered by gotenberg (magic bytes + attachment headers).
// reportInlineCardTest — the AI calls summarize_conversation → ReportArtifactCard
// renders inline + the open-link points at /report/[id]. Extracted out of the describe
// to stay under max-lines-per-function.
async function reportInlineCardTest(page: Page, playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  // After the tool call the LLM gets invoked once more to produce the HTML report
  // content; the mock follows next_reply.
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  await request.dispose();

  await enterChatWithCode(page);
  await fireFirstTurn(page, `summarize what we discussed${toolTag}${replyTag}`);

  // The report card (the summarize plugin's ui:// sandbox card) renders in the chat
  // stream; look inside the frame for its content.
  await expect(page.getByTestId('mcp-app-card-summarize_conversation'),
    'report card rendered').toBeVisible({ timeout: 10_000 });
  const card = reportCardInFrame(page);
  const reportID = await card.getAttribute('data-report-id');
  expect(reportID, 'report id 透到 card data attribute').toBeTruthy();

  // Clicking open as page → /report/[id] (assert on href; the actual click opens a
  // window via mcp-ui:link from the parent)
  const openLink = card.getByTestId('report-open-link');
  await expect(openLink).toHaveAttribute('href', `/report/${reportID}`);
}

async function reportPDFRouteTest(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  const reportID = extractReportID(await postAgentTurn(request, sess, `${toolTag}${replyTag}`));
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
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  await request.dispose();

  await enterChatWithCode(page);
  await fireFirstTurn(page, `summarize what we discussed${toolTag}${replyTag}`);
  await expect(page.getByTestId('mcp-app-card-summarize_conversation'))
    .toBeVisible({ timeout: 10_000 });
  const card = reportCardInFrame(page);
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
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  await request.dispose();

  await enterChatWithCode(page);
  await fireFirstTurn(page, `summarize what we discussed${toolTag}${replyTag}`);
  await expect(page.getByTestId('mcp-app-card-summarize_conversation'))
    .toBeVisible({ timeout: 10_000 });
  const card = reportCardInFrame(page);
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

// summaryReviseInPlaceTest — #129: summarizing the same conversation twice → the same
// report_id gets revised, not appended as a second one; that report holds the revised
// content. Extracted out of the describe to stay under max-lines-per-function.
async function summaryReviseInPlaceTest(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const toolTag1 = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag1 = await scriptMockReplyText(request, REPORT_HTML);
  const id1 = extractReportID(await postAgentTurn(request, sess, `${toolTag1}${replyTag1}`));
  expect(id1, 'first summarize produced a report').toBeTruthy();

  const toolTag2 = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag2 = await scriptMockReplyText(request, REPORT_HTML_REVISED);
  const id2 = extractReportID(await postAgentTurn(request, sess, `${toolTag2}${replyTag2}`));
  expect(id2, 'second summarize produced a report').toBeTruthy();

  // One report per conversation: the same report_id gets rewritten, not a new row.
  expect(id2, 'second summarize revises the same report (stable id)').toBe(id1);

  // That report now holds the revised content.
  const r = await request.get(`${BACKEND}/api/v1/report/${id1}`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json() as { html: string };
  expect(body.html, 'report holds the revised content').toContain('REVISED weekend plan');
  await request.dispose();
}

// reportRowIsStyledDocTest —— GET /report/[id] returns the owner-scoped row, and (unified render)
// the STORED artifact is already a complete self-contained styled document: sanitized-then-styled at
// generation, so the inline card, /report page, and PDF all render the identical thing. Guard the
// storage-layer invariant, not just how one surface happens to display it.
async function reportRowIsStyledDocTest(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  const turnRes = await postAgentTurn(request, sess, `${toolTag}${replyTag}`);
  const reportID = extractReportID(turnRes);
  expect(reportID, `report_id should be in SSE; got body:\n${turnRes}`).toBeTruthy();

  const r = await request.get(`${BACKEND}/api/v1/report/${reportID}`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json() as { html: string };
  expect(body.html).toContain('<h1>Quick recap</h1>');
  expect(body.html.trimStart().toLowerCase(), 'stored report is a full HTML document')
    .toMatch(/^<!doctype html/);
  expect(body.html, 'stored report carries the design language CSS').toContain('#B5391C');
  expect(body.html, 'stored report declares the serif body font').toContain('Newsreader');
  await request.dispose();
}

// summarizePersistsTest —— F-A-19: summarize is return_directly, so the turn ends on the tool
// result with NO model answer text. The old "persist iff answered()" rule dropped the whole dialog
// and the visitor lost the generated report after a reload. Drive the real persist path, then GET
// the conversation aggregate (restore's source) and assert the summarize dialog survived.
// RED before the fix: the conversation carries 0 dialogs with summarize_conversation.
async function summarizePersistsTest(playwright: Playwright): Promise<void> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const toolTag = await scriptMockToolCall(request, { name: 'summarize_conversation', args: {} });
  const replyTag = await scriptMockReplyText(request, REPORT_HTML);
  const produced = extractReportID(await postAgentTurn(request, sess, `${toolTag}${replyTag}`));
  expect(produced, 'summary produced').toBeTruthy();

  const r = await request.get(`${BACKEND}/api/v1/conversations/${sess.conversation_id}`, {
    headers: { Authorization: `Bearer ${sess.session_token}` },
  });
  expect(r.status()).toBe(200);
  const body = await r.json() as {
    conversation: { dialogs: Array<{ question: string; answer: string; tool_calls: unknown }> };
  };
  const hasSummarize = body.conversation.dialogs.some(
    (d) => JSON.stringify(d.tool_calls ?? []).includes('summarize_conversation'),
  );
  expect(hasSummarize,
    'the return_directly summarize dialog must persist (restore rebuilds from this aggregate)')
    .toBe(true);
  await request.dispose();
}

async function postAgentTurn(
  request: APIRequestContext,
  sess: { session_token: string; conversation_id: string },
  tags = '',
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    // conversation_id is required: the tool's internal INSERT into chat_reports goes
    // through this FK
    data: {
      system: 'You are alice.',
      user_message: `recap please${tags}`,
      conversation_id: sess.conversation_id,
    },
  });
  expect(res.status()).toBe(200);
  return await res.text();
}

function extractReportID(sse: string): string {
  // The SSE frame is data:{...result: "<string>"}; the string is the tool result in
  // JSON form, so its quotes are escaped. Try both forms.
  const escaped = sse.match(/\\"report_id\\":\\"([0-9a-f-]{36})\\"/);
  if (escaped !== null) return escaped[1] ?? '';
  const plain = sse.match(/"report_id":"([0-9a-f-]{36})"/);
  return plain === null ? '' : plain[1] ?? '';
}

// enterCodeSession already skipped the name picker and waited for /sessions 200, so
// the picker is already consumed by this point. Don't dismiss it a second time here —
// a second isVisible-then-click can sample the window while the picker is mid-unmount,
// landing the click on a button that's being detached → a 10s timeout (a
// check-then-act race).
async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
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
