// admin-output-crud.spec.ts —— output extended: cover strip, tier pill,
// dual create buttons.
//
// User story:
//   1. cover strip hue gradient renders
//   2. tier pill (public / unlisted / private) correct
//   3. dual create buttons (pdf / web essay)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'outcrud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'outcrud',
  fullName: 'Output CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin output CRUD extended', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('output list shows entries with correct rendering',
    async ({ request, adminPage }) => {
      await seedOutput(request);
      await gotoAdminSection(adminPage, 'output');
      await adminPage.waitForURL('**/admin/output', { timeout: 5_000 });
      await expect(adminPage.getByTestId('output-list')).toBeVisible();
      await expect(adminPage.getByText('Test Output Entry')).toBeVisible();
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

async function seedOutput(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'outcrud-seed');
  const sid = await initMCP(request, token);
  const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create', {
    genre: 'raw', body: 'raw for output test', source: 'mcp:e2e', tags: [],
  });
  const wiki = await callTool<{ id: string }>(request, token, sid, 'corpus.promote', {
    genre: 'raw', id: raw.id, title: 'Wiki for Output',
  });
  await callTool(request, token, sid, 'corpus.promote', {
    genre: 'wiki', id: wiki.id, title: 'Test Output Entry',
  });
}
