// application-opened.spec.ts —— roadmap E1 · story 1.1 "recruiter 打开了，我知道".
//
// Done when: an untouched application shows nothing; after the first visit carrying its code (or
// the first conversation on it) it shows "opened" with the exact time; a later conversation does
// not move that time; with visit tracking off, the conversation alone still counts.
//
// Contract (beyond fixtures/application-loop.ts):
//   • 1.1.a —— a consenting browser opening `/?code=<code>` leaves a non-bot monitor event whose
//     code_id is that code's id, whatever the page then does with the query (the landing strips it).
//   • 1.1.c —— each admin applications row carries `application-opened-<id>` once opened: English
//     text "opened", the time, and "<n> question(s)"; an unopened row has no such element.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  applicationRow, commitApplication, setupLoopOwner, type Committed, type LoopOwner,
} from '@/fixtures/application-loop';
import { callTool } from '@/fixtures/mcp';
import { readEvents } from '@/fixtures/monitor';
import { gotoAdminSection } from '@/fixtures/navigate';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';
import { issueSession, sendMessage, type VisitorSession } from '@/fixtures/visitor';

const HANDLE = 'appopened';
const OWNER = { email: `${HANDLE}@example.com`, password: 'correct-horse-battery-staple' };

let o: LoopOwner;
let first: Committed;
let second: Committed;
let visitor: APIRequestContext;
let openedAt = '';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.use({ ownerCredentials: OWNER });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, HANDLE);
  first = await commitApplication(o, 0);
  second = await commitApplication(o, 1);
  visitor = await playwright.request.newContext();
});

test.afterAll(async () => {
  await callTool(o.request, o.apiToken, o.sid, 'monitoring.set', { enabled: true });
  await visitor.dispose();
  await o.request.dispose();
});

function openSession(c: Committed, name: string): Promise<VisitorSession> {
  return issueSession(visitor, { handle: o.handle, mode: 'code', code: c.code, visitor_name: name });
}

async function ask(sess: VisitorSession, q: string): Promise<void> {
  expect((await sendMessage(visitor, sess, q)).status(), `the turn "${q}" ran`).toBe(200);
}

test('an untouched application shows nothing opened', async () => {
  const row = await applicationRow(o, first.applicationID);
  expect(row.id, 'presence: the committed application is listed').toBe(first.applicationID);
  expect(row.opened_at, 'nobody has opened it').toBeNull();
  expect(row.questions, 'nobody has asked anything').toBe(0);
});

test('1.1.a — a browser opening /?code= records a visit carrying that code', async ({ playwright, request }) => {
  const browser = await openVisitorBrowser(playwright);
  await browser.read(`/?code=${first.code}`);
  await browser.dispose();
  await expect.poll(async () => (await readEvents(request, OWNER)).some((e) => e.code_id === first.codeID),
    { timeout: 30_000, intervals: [1_000], message: 'a non-bot event carries the code' }).toBe(true);
});

test('1.1.b — the visit sets opened_at; conversations add questions and leave the time alone', async () => {
  await expect.poll(async () => (await applicationRow(o, first.applicationID)).opened_at,
    { timeout: 30_000, message: 'opened after the visit' }).not.toBeNull();
  openedAt = (await applicationRow(o, first.applicationID)).opened_at ?? '';
  const sess = await openSession(first, 'Recruiter');
  await ask(sess, 'What did you build at your last job?');
  await expect.poll(async () => (await applicationRow(o, first.applicationID)).questions,
    { timeout: 15_000 }).toBe(1);
  expect((await applicationRow(o, first.applicationID)).opened_at, 'the first open stays the time').toBe(openedAt);
  await ask(sess, 'And why are you looking now?');
  await expect.poll(async () => (await applicationRow(o, first.applicationID)).questions,
    { timeout: 15_000 }).toBe(2);
  expect((await applicationRow(o, second.applicationID)).opened_at, 'the other application is untouched').toBeNull();
});

test('1.1.c — the admin row says opened and how many questions; an unopened row says nothing', async ({ adminPage }) => {
  await gotoAdminSection(adminPage, 'applications');
  const opened = adminPage.getByTestId(`application-opened-${first.applicationID}`);
  await expect(opened).toBeVisible({ timeout: 15_000 });
  await expect(opened).toContainText(/opened/i);
  await expect(opened).toContainText(/2 questions/i);
  await expect(adminPage.getByTestId(`application-row-${second.applicationID}`), 'presence: the other row').toBeVisible();
  await expect(adminPage.getByTestId(`application-opened-${second.applicationID}`), 'no inferred progress').toHaveCount(0);
});

test('with visit tracking off, a conversation alone still marks it opened', async () => {
  await callTool(o.request, o.apiToken, o.sid, 'monitoring.set', { enabled: false });
  expect((await applicationRow(o, second.applicationID)).opened_at, 'before: unopened').toBeNull();
  const sess = await openSession(second, 'Hiring Manager');
  await ask(sess, 'Can you start next month?');
  await expect.poll(async () => (await applicationRow(o, second.applicationID)).opened_at,
    { timeout: 30_000, message: 'opened from the conversation' }).not.toBeNull();
  expect((await applicationRow(o, second.applicationID)).questions).toBe(1);
});
