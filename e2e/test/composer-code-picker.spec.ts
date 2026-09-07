// composer-code-picker.spec.ts —— the résumé composer's access-code picker is ALWAYS present, even
// when the owner has no active codes (owner: "no active codes 和有没有 picker 有什么关系"). Whether
// there are codes to pick is a data question; the picker control itself must not vanish.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'codepicker@example.com', password: 'correct-horse-battery-staple',
  handle: 'codepicker', fullName: 'Code Picker Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé composer code picker (A2)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the code picker control is present in the composer even with no active codes',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      // A fresh owner with NO codes; open a draft in the composer.
      const created = await api.post(`${BACKEND}/api/admin/drafts`, {
        headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
      });
      const id = (await created.json() as { id: string }).id;

      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      // The picker is there regardless of whether there are codes to pick.
      await expect(page.getByTestId('composer-code-select'),
        'the code picker control is present even with zero active codes').toBeVisible();
      await api.dispose();
    });
});
