// resume-composer-mobile-a4.spec.ts —— A3 item B: the Puck editor's résumé sheet is ASPECT-LOCKED to
// A4 (210:297), which is what keeps its proportions on any viewport width, mobile included (owner:
// "puck 的编辑页要保持 A4 纸张的大小，mobile 保持他的比例"). The sheet is `aspect-[210/297] max-w-full`,
// so `max-w-full` shrinks its width to whatever space it gets and `aspect-ratio` derives the height
// from that width — the ratio can never drift, at 794px or at a phone width.
//
// This asserts the computed `aspect-ratio` on the sheet, not a boundingBox at a fixed phone size: the
// aspect-ratio IS the mobile guarantee (viewport-independent), whereas boundingBox at 390px would be
// measuring Puck's desktop-first editor shell squeezing the canvas, not the sheet's proportions.
// resume-composer-sections already checks the rendered ratio at the desktop viewport; this pins the
// invariant that carries it to mobile. Dropping the aspect box (e.g. a fixed height) fails this.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'mobile-a4@example.com', password: 'correct-horse-battery-staple',
  handle: 'mobilea4', fullName: 'Mobile A4 Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the Puck résumé sheet is A4 aspect-locked (holds its ratio on mobile) — A3 B', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the résumé sheet has a locked 210/297 aspect-ratio', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const id = await seed(api, csrf);

    await goto(page, `/admin/edit-resume/${id}`);
    await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

    const canvas = page.frameLocator('iframe').first();
    const paper = canvas.locator('.sm-resume-paper').first();
    await expect(paper, 'the résumé sheet renders').toBeVisible({ timeout: 15_000 });

    // The A4 lock: `aspect-ratio: 210 / 297`. Chromium reports it as "210 / 297". Normalize spaces and
    // compare the numeric pair, so the ratio (not any width) is what's asserted.
    const aspect = await paper.evaluate((el) => getComputedStyle(el).aspectRatio);
    expect(aspect.replace(/\s+/g, ''), `sheet is A4 aspect-locked (got "${aspect}")`).toBe('210/297');

    // And it does render as A4-proportioned at the current width (the lock is actually in effect).
    const box = await paper.boundingBox();
    expect(box, 'the sheet has a box').not.toBeNull();
    const ratio = box!.width / box!.height;
    expect(Math.abs(ratio - 210 / 297), `renders A4-proportioned (got ${ratio.toFixed(3)})`).toBeLessThan(0.04);
    await api.dispose();
  });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'M', email: 'm@ex.io', phone: '', location_line: 'Remote', site: '', links: [] },
    summary: 'a short summary', works: [], educations: [], skills: [{ category: '', items: ['x'] }],
    social: [], custom: [], accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
