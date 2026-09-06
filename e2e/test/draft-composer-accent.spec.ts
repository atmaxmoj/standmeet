// draft-composer-accent.spec.ts —— the owner can set the résumé's accent colour (owner: "还有那个
// 字体颜色"), and it persists + reaches the render. The résumé has one accent (section heads / company
// names / rules); the composer exposes a colour picker for it. Colour can't be read from a PDF text
// layer, so this guards the PLUMBING: the picked colour round-trips UI → API → store → reopen, and the
// Typst template renders a real PDF with a custom accent (no crash on a non-default colour).
//
// RED without accent support: there is no composer-accent control, and resume_content carries no accent.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'accent@example.com', password: 'correct-horse-battery-staple',
  handle: 'accentowner', fullName: 'Accent Owner',
};
const COLOR = '#1f7a3d'; // a distinctive non-default green

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · owner-chosen accent colour', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('set accent → persists through save/reopen and the PDF still renders', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('composer-panel-header').click();
    // A <input type="color"> doesn't take Playwright fill; set the value via the native setter so
    // React's onChange fires (the same mechanism fill uses for text inputs).
    await page.getByTestId('composer-accent').evaluate((el, c) => {
      const input = el as HTMLInputElement;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- native value setter, called immediately
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, c);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, COLOR);
    await expect(page.getByTestId('composer-accent')).toHaveValue(COLOR);
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    // Persisted through the product's own read path (UI → API → store).
    const stored = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}`);
    expect(stored.status()).toBe(200);
    const detail = await stored.json() as { resume_content: { accent?: string } };
    expect(detail.resume_content.accent, 'accent stored in resume_content').toBe(COLOR);

    // The Typst template renders a real PDF with the custom accent — no crash on a non-default colour.
    const pdf = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}/preview.pdf`);
    expect(pdf.status()).toBe(200);
    expect((await inspectPDF(await pdf.body())).text.length, 'PDF has content').toBeGreaterThan(50);

    // Reopen → the picker keeps the chosen colour.
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('composer-panel-header').click();
    await expect(page.getByTestId('composer-accent'), 'accent persisted on reopen').toHaveValue(COLOR);
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
