// access-codes.spec.ts — owner issues a code via the admin UI → the visitor uses it to chat.
//
// User story:
//   owner wants HR to see only the work-tagged slice of the corpus. On the
//   admin /codes page, fill in INTRO-001 / "Intro for HR" / tag=work →
//   create. HR uses this code (before the /gate UI lands, this simulates
//   the visitor here: taking the code straight to POST /api/v1/sessions
//   = a code-tier session → the chat flow works end to end).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner issues an access code in admin; visitor uses it', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedTaggedWiki(request);
    await request.dispose();
  });

  test('owner creates INTRO-001 in /admin/codes → visitor chats with that code',
    async ({ adminPage: page, request }) => {
      await openCodes(page);
      await createCodeInUI(page, 'INTRO-001', 'Intro for HR');
      await expectCodeRowVisible(page, 'INTRO-001');
      // F-D-1 guard: the assertion above passes on the optimistic store MUTATE. Reload so the
      // list comes from a FRESH GET /api/admin/codes → z.array(CodeViewSchema) parse (the path
      // that blanked to "No codes yet" when one row carried ghosts:null). The code must still render.
      await page.reload();
      await page.waitForURL('**/admin/codes', { timeout: 5_000 });
      await expectCodeRowVisible(page, 'INTRO-001');
      await expect(page.getByTestId('code-list')).not.toContainText('No codes yet');
      await visitorChatsWithCode(request);
    });

  // F-D-12 — a code must be able to be **handed over**. Item check 2 literally says
  // "Click copy-share", but the card has no such control: `CodeQRModal` (the **only**
  // place in the product with a copy-link) never opens.
  // `CodesSection` passes `openQR` all the way down to `CodeCard`, but the card signs it
  // off as `onShowQR: _onShowQR` — the underscore is the "deliberately unused" convention,
  // meaning someone hit the unused-variable lint and silenced it instead of wiring it up.
  // The declaration is complete, the wire reaches the component, but the tail end is
  // dropped on purpose.
  //
  // The assertion doesn't pin down "which exact control": the card just needs **some**
  // element that opens the share panel, and once opened, that panel must yield a
  // copyable link.
  test('a card can hand its code over: the share panel opens and carries the link',
    async ({ adminPage: page }) => {
      await openCodes(page);
      await createCodeInUI(page, 'SHARE-001', 'Share test');
      await expectCodeRowVisible(page, 'SHARE-001');

      const card = page.getByTestId('code-card-SHARE-001');
      await card.getByTestId('code-qr-open').click();

      const modal = page.getByTestId('code-qr-modal');
      await expect(modal, '分享面板要真的打开').toBeVisible({ timeout: 10_000 });
      await expect(modal, '面板上要有那条能递出去的链接').toContainText('SHARE-001');
      await expect(
        modal.getByRole('button', { name: /copy/i }),
        '要能复制 —— 让 owner 自己把 URL 从卡片上抄下来不算「能分享」',
      ).toBeVisible();
    });
});

async function seedTaggedWiki(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'I built FlexMesh for Canadian delivery drivers.',
    title: 'Work — FlexMesh',
    tags: ['work'],
  });
}

async function openCodes(page: Page): Promise<void> {
  await gotoAdminSection(page, 'codes');
  await page.waitForURL('**/admin/codes', { timeout: 5_000 });
}

async function createCodeInUI(
  page: Page, code: string, label: string,
): Promise<void> {
  // The /admin/codes UI now opens the create form via a modal; click "+ new code" first.
  // After the retrieval redesign, the access field changed from tags to a
  // corpus_permissions JSON textarea — this spec doesn't verify the permissions content
  // (the dedicated visitor-chat-permissions-deny spec does), so just leave it empty
  // (= allow everything).
  await page.getByRole('button', { name: /new code/i }).click();
  await page.getByTestId('code-input').fill(code);
  await page.getByTestId('code-label').fill(label);
  await page.getByTestId('code-create').click();
}

async function expectCodeRowVisible(page: Page, code: string): Promise<void> {
  await expect(page.getByTestId(`code-row-${code}`)).toBeVisible({ timeout: 5_000 });
}

// The visitor chats with a code — no /gate UI yet, so the visitor side is simulated;
// switch to UI-driven once the gate UI lands.
async function visitorChatsWithCode(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: 'INTRO-001', visitor_name: 'HR',
  });
  const res = await sendMessage(request, sess, 'tell me about your work');
  expect(res.status()).toBe(200);
}
