// admin-conversations-extended.spec.ts —— conversations: sentiment column,
// transcript modal, filter by code.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto, gotoAdminSection } from '@/fixtures/navigate';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession, sendMessage } from '@/fixtures/visitor';

// BROKEN_DIAGRAM_REPLY — prose that stands on its own, plus a mermaid block that fails
// to compile (the same fixture visitor-chat-answer-render uses: one shape, two audiences).
const BROKEN_DIAGRAM_REPLY = [
  'The pipeline runs in three stages: fetch, curate, publish.',
  '',
  '```mermaid',
  'graph LR; A --> ; B[[',
  '```',
].join('\n');

// seedBrokenDiagramConversation — a conversation whose reply contains a diagram that fails
// to compile, used for the owner half of the gate check.
async function seedBrokenDiagramConversation(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: 'CONV-A', visitor_name: 'Broken Diagram',
  });
  const tag = await scriptMockReplyText(request, BROKEN_DIAGRAM_REPLY);
  await (await sendMessage(request, sess, `draw it${tag}`)).body();
}

const OWNER = {
  email: 'conv-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'convext',
  fullName: 'Conv Ext Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin conversations extended', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const apiToken = await createAPIToken(request, csrf, 'conv-ext-seed');
    const sid = await initMCP(request, apiToken);
    await seedPublicWiki(request, apiToken, sid, {
      body: 'conv ext intro.', title: 'Conv Ext Intro',
    });
    await createCode(request, csrf, { code: 'CONV-A', label: 'Code A' });
    await createCode(request, csrf, { code: 'CONV-B', label: 'Code B' });
    const sessA = await issueSession(request, {
      handle: OWNER.handle, code: 'CONV-A', visitor_name: 'Visitor A',
    });
    await (await sendMessage(request, sessA, 'hello from A')).body();
    const sessB = await issueSession(request, {
      handle: OWNER.handle, code: 'CONV-B', visitor_name: 'Visitor B',
    });
    await (await sendMessage(request, sessB, 'hello from B')).body();
    await seedBrokenDiagramConversation(request);
    await request.dispose();
  });

  test('conversations table renders with sentiment column',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.waitForURL('**/admin/conversations', { timeout: 5_000 });
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toBeVisible();
      await expect(adminPage.getByRole('columnheader', { name: 'sentiment' })).toBeVisible();
    });

  test('click row → transcript modal opens with seeded message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Visitor A', { exact: true }).click();
      const body = adminPage.getByTestId('transcript-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      await expect(body).toContainText('hello from A');
    });

  // The transcript modal is the only real surface; the redundant inline panel that reads
  // an empty conv.transcript and always shows "placeholder for now" has been removed
  // (clicking a row popping the modal AND expanding the placeholder was a bug).
  test('opening a conversation shows NO leftover transcript placeholder panel',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Visitor A', { exact: true }).click();
      await expect(adminPage.getByTestId('transcript-body')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(/transcript not loaded|placeholder for now/i))
        .toHaveCount(0);
    });

  // The other half of the gate. The visitor's compile-broken diagram is hidden from them
  // (the prose stands on its own), **but the problem must not just disappear**: the owner
  // is the only one who can fix the prompt / skill, and this transcript view is where
  // they'd see it. Verifying only the first half would build a mechanism that buries the
  // model's error.
  test('transcript modal shows the compile error a visitor was spared',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'conversations');
      await adminPage.getByText('Broken Diagram', { exact: true }).click();
      const body = adminPage.getByTestId('transcript-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      await expect(body, '正文照常在').toContainText('three stages');
      await expect(
        body.getByTestId('mermaid-error'),
        'owner 这一侧要看得见那句编译错误',
      ).toBeVisible({ timeout: 10_000 });
    });

  test('filter by code → only matching conversations',
    async ({ adminPage }) => {
      await goto(adminPage, `/admin/conversations?code=CONV-A`);
      await expect(adminPage.getByText('Visitor A', { exact: true })).toBeVisible();
      await expect(adminPage.getByText('Visitor B', { exact: true })).toHaveCount(0);
    });
});
