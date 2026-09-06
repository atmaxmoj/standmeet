// draft-composer-divider.spec.ts —— the owner can add a horizontal divider between their custom
// sections (owner: "分割线能自己添加"). A divider is a custom entry with kind:'divider'; the composer's
// custom panel has a "+ add a divider" button, and both Typst templates render it as a rule.
//
// Colour/rules can't be read from a PDF text layer, so this guards the PLUMBING: adding a divider
// persists it as kind:'divider' through UI → API → store, the divider row shows in the composer, and
// the Typst PDF still renders (the template draws the rule without crashing).
//
// RED without divider support: no "+ add a divider" control, and custom carries no kind.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'divider@example.com', password: 'correct-horse-battery-staple',
  handle: 'dividerowner', fullName: 'Divider Owner',
};

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · owner adds a divider', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('add a divider → persists as kind:divider and the PDF still renders', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('composer-panel-custom').click();
    await page.getByTestId('composer-custom-add').click();
    await page.getByTestId('composer-custom-title-c-new-0').fill('Languages');
    await page.getByTestId('composer-custom-value-c-new-0').fill('English · Mandarin');
    await page.getByTestId('composer-divider-add').click();
    await expect(page.getByTestId('composer-divider-row-c-new-1'), 'the divider row shows').toBeVisible();

    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    // Persisted as a divider through the product's own read path.
    const stored = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}`);
    const detail = await stored.json() as { resume_content: { custom: { kind?: string }[] } };
    const kinds = detail.resume_content.custom.map((c) => c.kind ?? '');
    expect(kinds, 'a divider is stored in custom').toContain('divider');

    // The Typst template renders the rule without crashing.
    const pdf = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}/preview.pdf`);
    expect(pdf.status()).toBe(200);
    const { text } = await inspectPDF(await pdf.body());
    expect(text, 'the custom section still renders').toContain('English');
  });
});

async function seedDraft(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  const id = (await res.json() as { id: string }).id;
  await request.dispose();
  return id;
}
