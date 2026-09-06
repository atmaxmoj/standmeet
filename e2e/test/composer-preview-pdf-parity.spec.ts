// composer-preview-pdf-parity.spec.ts —— what the owner sees in the live WASM preview must match what
// the committed PDF renders (matrix B3). The two are SEPARATE renderers of the same draft (typst.ts
// WASM in the browser vs the server `typst` binary), tested by separate specs on separate surfaces —
// so they can silently diverge. This pins them together: fill distinctive content, then assert the
// SAME sentinels appear in BOTH the preview SVG and the draft's rendered PDF.
//
// RED if a change lands in one renderer but not the other (a template only the server uses, a font
// only the WASM has, content dropped on one path).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'parity@example.com', password: 'correct-horse-battery-staple',
  handle: 'parityowner', fullName: 'Parity Owner',
};
const NAME = 'zqxparityname';       // lowercased by the template already
const SUMMARY = 'zqxparitysummary';

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('composer · live preview matches the committed PDF (B3)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('the same content appears in the preview SVG and the rendered PDF', async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('composer-panel-header').click();
    await page.getByTestId('composer-name').fill(NAME);
    await page.getByTestId('composer-panel-summary').click();
    await page.getByTestId('composer-summary').fill(SUMMARY);

    // Preview (WASM): both sentinels are on the canvas.
    const svgBox = page.getByTestId('composer-preview-svg');
    await expect(svgBox).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
    await expect(svgBox, 'name in the preview').toContainText(NAME);
    await expect(svgBox, 'summary in the preview').toContainText(SUMMARY);

    // PDF (server): the SAME sentinels, so preview and committed output agree.
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });
    const res = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}/preview.pdf`);
    expect(res.status()).toBe(200);
    const { text } = await inspectPDF(await res.body());
    expect(text, 'name in the PDF too').toContain(NAME);
    expect(text, 'summary in the PDF too').toContain(SUMMARY);
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
