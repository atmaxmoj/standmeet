// composer-fits-viewport.spec.ts —— both résumé editors (a draft's composer and a master's editor)
// fill exactly one screen: the page itself does not scroll, and each panel (outline, canvas,
// fields) scrolls on its own.
//
// Found by the owner on the master editor: "这个编辑器应该在这页里面，不要更长，各自的地方各自scroll".
// The admin shell drops its gutters only for routes it knows are full-bleed editors; it knew
// /admin/edit-resume and not /admin/edit-master, so the master editor grew past the screen and the
// whole page scrolled. Geometry, not text: a squeezed or overflowing layout still renders every label.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { contentWith, masterCard, openComposerFor, openDrafts, seedDraft, seedMaster } from '@/fixtures/resume-masters';

const OWNER = {
  email: 'composer-viewport@example.com', password: 'correct-horse-battery-staple',
  handle: 'composerviewport', fullName: 'Composer Viewport Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé editors fit one screen', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the master editor: the page does not scroll, the editor ends inside the screen',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      await seedMaster(api, csrf, { name: 'Viewport', resume_content: contentWith('VIEWPORTSUMMARY') });
      await openDrafts(page);
      await masterCard(page, 'Viewport').getByTestId('master-edit').click();
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      await expectFitsViewport(page);
      await api.dispose();
    });

  test('the draft composer: the same', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const d = await seedDraft(api, csrf, { company: 'Viewport Co', role: 'Engineer', blank: true });
    await openComposerFor(page, d.id);
    await expectFitsViewport(page);
    await api.dispose();
  });
});

// expectFitsViewport —— the document is no taller than the window (nothing to scroll at page level),
// and the editor's box ends at or above the window's bottom edge.
async function expectFitsViewport(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return doc.scrollHeight - window.innerHeight;
  }), { message: 'the page itself must not scroll', timeout: 10_000 }).toBeLessThanOrEqual(1);
  const box = await page.getByTestId('puck-composer').boundingBox();
  expect(box, 'the composer is laid out').not.toBeNull();
  const viewport = page.viewportSize();
  expect(box!.y + box!.height, 'the composer ends inside the window').toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
}
