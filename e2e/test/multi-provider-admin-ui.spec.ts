// multi-provider-admin-ui.spec.ts —— the owner's side of the provider book.
//
// The API-level spec (multi-provider-resolution) proves the resolution chain. It would stay green
// with no panel at all: an owner who cannot see the book, add an entry, or point a code at one has
// nothing, however correct the resolver is. This spec drives the same feature through the screen —
// and the last test closes the loop by sending a real visitor turn on a code that was pointed at a
// provider **from the modal**, then asking the gateway which upstream it got.
//
// One gateway, distinct model strings: which upstream served the turn is the observable.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { lastGatewayRequest, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { gotoAdminSection } from '@/fixtures/navigate';
import { expectErrorToast } from '@/fixtures/toast';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'providerui@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'providerui',
  fullName: 'Provider UI Owner',
};

const GATEWAY = 'http://llm-gateway:9300';
// CLAIM_LABEL —— what first-run claim names the entry it creates (repo/provider_view.go).
const CLAIM_LABEL = 'default';
const UI_LABEL = 'second-key';
const UI_MODEL = 'mock-model-from-ui';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('provider book · the owner can see the book and edit it', () => {
  test('the panel lists the entry claim created, marked default', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'api-mcp');
    await expect(adminPage.getByTestId('provider-book-panel')).toBeVisible();
    await expect(
      adminPage.getByTestId('provider-list').getByTestId('provider-default-badge'),
      'exactly one default, and it is visible as such',
    ).toHaveCount(1, { timeout: 5_000 });
  });

  test('adding an entry from the form puts it in the list with its key set',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      await addProvider(adminPage, { label: UI_LABEL, model: UI_MODEL, key: 'sk-ui-000000000000' });

      const row = adminPage.getByTestId(`provider-row-${UI_LABEL}`);
      await expect(row).toBeVisible({ timeout: 5_000 });
      // The model shows on the row: two entries on the same preset are told apart by it, and the
      // code/role dropdowns key off the same pair.
      await expect(row, 'the row names the model it will use').toContainText(UI_MODEL);
      await expect(row, 'and reports the key landed').toContainText('key set');
    });

  test('making it default moves the badge; the old default keeps its row',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const row = adminPage.getByTestId(`provider-row-${UI_LABEL}`);
      await expect(row).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId(`provider-make-default-${UI_LABEL}`).click();

      await expect(row.getByTestId('provider-default-badge')).toBeVisible();
      await expect(
        adminPage.getByTestId('provider-list').getByTestId('provider-default-badge'),
        'still exactly one default — the badge moved, it did not multiply',
      ).toHaveCount(1);
      // The button for the entry that is now default is gone: it is already the default.
      await expect(adminPage.getByTestId(`provider-make-default-${UI_LABEL}`)).toHaveCount(0);
    });

  test('deleting the default is refused with a sentence, not a status code',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const row = adminPage.getByTestId(`provider-row-${UI_LABEL}`);
      await expect(row.getByTestId('provider-default-badge')).toBeVisible({ timeout: 5_000 });

      await adminPage.getByTestId(`provider-delete-${UI_LABEL}`).click();

      // Not "409", not "request failed" — the owner is told what to do about it.
      await expectErrorToast(adminPage, /make another one the default/i);
      await expect(row, 'and the entry is still there').toBeVisible();
    });
});

test.describe('provider book · the code modal reaches it', () => {
  test('a code issued from the modal against this entry serves its model',
    async ({ adminPage, request }) => {
      // Move the default back onto claim's entry FIRST. If the picked entry were also the default,
      // the turn below would land on it either way and this test could not fail — a picker wired to
      // nothing would read exactly the same.
      await gotoAdminSection(adminPage, 'api-mcp');
      await adminPage.getByTestId(`provider-make-default-${CLAIM_LABEL}`).click();
      await expect(
        adminPage.getByTestId(`provider-row-${CLAIM_LABEL}`).getByTestId('provider-default-badge'),
      ).toBeVisible({ timeout: 5_000 });

      await gotoAdminSection(adminPage, 'codes');
      await adminPage.waitForURL('**/admin/codes', { timeout: 5_000 });
      await adminPage.getByRole('button', { name: /new code/i }).click();
      await adminPage.getByTestId('code-input').fill('PROV-UI-001');
      await adminPage.getByTestId('code-label').fill('pointed at the second key');

      const picker = adminPage.getByTestId('code-field-provider');
      await expect(
        picker.locator('option', { hasText: UI_LABEL }),
        'the book reaches the code modal',
      ).toHaveCount(1, { timeout: 5_000 });
      await picker.selectOption({ label: `${UI_LABEL} · ${UI_MODEL}` });
      await adminPage.getByTestId('code-create').click();
      await expect(adminPage.getByTestId('code-row-PROV-UI-001')).toBeVisible({ timeout: 5_000 });

      // The turn is the point: a picker that writes nowhere would pass every assertion above.
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: 'PROV-UI-001', visitor_name: 'V',
      });
      const tag = await scriptMockReplyText(request, 'ok');
      await sendMessage(request, sess, `hello${tag}`);
      const seen = await lastGatewayRequest(request, tag);
      expect(seen.found, 'the gateway recorded this turn').toBe(true);
      expect(seen.model, 'served by the entry picked in the modal').toBe(UI_MODEL);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

// addProvider —— fill the "add an entry" row and submit. Endpoint points at the mock gateway so the
// entry is usable in a real turn, not just listable.
async function addProvider(
  page: Page, entry: { label: string; model: string; key: string },
): Promise<void> {
  await expect(page.getByTestId('provider-add-form')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('provider-new-label').fill(entry.label);
  await page.getByTestId('provider-new-provider').selectOption('anthropic');
  await page.getByTestId('provider-new-endpoint').fill(GATEWAY);
  await page.getByTestId('provider-new-model').fill(entry.model);
  await page.getByTestId('provider-new-key').fill(entry.key);
  await page.getByTestId('provider-new-add').click();
}
