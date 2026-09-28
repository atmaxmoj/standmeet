// resume-composer-mobile-a4.spec.ts —— A3 item B: the Puck editor's résumé sheet is ASPECT-LOCKED to
// its paper, which is what keeps its proportions on any viewport width, mobile included (owner:
// "puck 的编辑页要保持 A4 纸张的大小，mobile 保持他的比例"). Since 2026-09-28 the paper is the owner's
// setting — US Letter (default) or A4 — so each is checked: the sheet is `max-w-full` with an
// aspect-ratio, so its width shrinks to whatever space it gets and the height follows — the ratio can
// never drift, at full width or at a phone width.
//
// This asserts the computed `aspect-ratio` on the sheet, not a boundingBox at a fixed phone size: the
// aspect-ratio IS the mobile guarantee (viewport-independent), whereas boundingBox at 390px would be
// measuring Puck's desktop-first editor shell squeezing the canvas, not the sheet's proportions.
// Dropping the aspect box (e.g. a fixed height) fails this.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { openReader } from '@/fixtures/navigate';
const OWNER = {
  email: 'mobile-a4@example.com', password: 'correct-horse-battery-staple',
  handle: 'mobilea4', fullName: 'Mobile A4 Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the Puck résumé sheet is aspect-locked to its paper (holds its ratio on mobile) — A3 B', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('A4 chosen: the sheet is locked to 210/297', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seedWith(playwright, 'a4');
    await expectSheetRatio(page, id, 297 / 210);
  });

  test('by default (US Letter) the sheet is locked to 8.5/11', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seedWith(playwright, undefined);
    await expectSheetRatio(page, id, 11 / 8.5);
  });
});

// expectSheetRatio —— the computed aspect-ratio (height/width) is the paper's, and the rendered box
// follows it at the current width (the lock is actually in effect).
async function expectSheetRatio(page: Page, id: string, heightOverWidth: number): Promise<void> {
  await openReader(page, `/admin/edit-resume/${id}`);
  await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
  const sheet = page.frameLocator('iframe').first().locator('[data-resume-sheet]').first();
  await expect(sheet, 'the résumé sheet renders').toBeVisible({ timeout: 15_000 });

  // Chromium reports aspect-ratio as "w / h" — compare the numbers, not the spelling.
  const aspect = await sheet.evaluate((el) => getComputedStyle(el).aspectRatio);
  const [w, h] = aspect.split('/').map((s) => Number(s.trim()));
  expect(Math.abs(h! / w! - heightOverWidth), `sheet aspect-ratio (got "${aspect}")`).toBeLessThan(0.001);

  const box = await sheet.boundingBox();
  expect(box, 'the sheet has a box').not.toBeNull();
  expect(Math.abs(box!.height / box!.width - heightOverWidth), 'renders in its paper\'s proportions').toBeLessThan(0.04);
}

async function seedWith(playwright: { request: { newContext(): Promise<APIRequestContext> } }, paper: string | undefined): Promise<string> {
  const api = await playwright.request.newContext();
  const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
  const { id } = await createDraft(api, csrf, { company: 'Acme', role: 'Engineer' });
  const resume_content = {
    identity: { name: 'M', email: 'm@ex.io', phone: '', location_line: 'Remote', site: '', links: [] },
    summary: 'a short summary', works: [], educations: [], skills: [{ category: '', items: ['x'] }],
    social: [], custom: [], accent: '', ...(paper ? { paper_size: paper } : {}),
  };
  await updateDraft(api, csrf, id, { resume_content, template: '' });
  await api.dispose();
  return id;
}
