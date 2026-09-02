// corpus-curation.spec.ts -- the AI pushes raw into the corpus over MCP, and the owner sees
// it in admin.
//
// User story:
//   The owner chats with the AI in Cursor and has the AI push an insight into the corpus
//   with raw_dump. The owner then opens /admin/raw to confirm it arrived -- they should see
//   the original text. This is the first step of the owner curation loop ("what did I have
//   the AI write"); a promote-to-wiki UI will later be added to the same page for the owner
//   to decide whether to keep it.
//
// Simulating the AI client side: the spec calls MCP raw_dump directly, equivalent to Cursor
// / Claude Desktop calling it automatically. The MCP protocol itself is the user surface for
// owner ingest.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const RAW_BODY = 'I think microservices were Amazon org chart in YAML.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('AI pushes raw insight via MCP; owner sees it in admin', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await aiPushesRaw(request, RAW_BODY);
    await request.dispose();
  });

  test('owner opens /admin/raw and sees the AI-pushed entry',
    async ({ adminPage: page }) => {
      await openRaw(page);
      // Scope the assertion to the list, not "this text is somewhere on the page": the
      // sidebar's corpus-constellation ticker also shows the same recent entry, so a
      // page-wide getByText would hit both (strict mode violation).
      // What this test needs to prove is "the owner can see it in the raw list", so look there.
      await expect(page.getByTestId('raw-list')).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByTestId('raw-list').getByText(RAW_BODY, { exact: false }),
      ).toBeVisible();
    });
});

async function aiPushesRaw(request: APIRequestContext, body: string): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'cursor-mbp');
  const sid = await initMCP(request, apiToken);
  await callTool<{ id: string }>(request, apiToken, sid, 'corpus.create', {
    genre: 'raw', body, source: 'mcp:cursor', tags: ['architecture'],
  });
}

async function openRaw(page: Page): Promise<void> {
  await gotoAdminSection(page, 'raw');
  await page.waitForURL('**/admin/raw', { timeout: 5_000 });
}
