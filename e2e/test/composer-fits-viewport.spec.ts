// composer-fits-viewport.spec.ts —— both résumé editors (a draft's composer and a master's editor)
// fill exactly one screen: the page itself does not scroll, and each panel (outline, canvas,
// fields) scrolls on its own.
//
// Found by the owner on the master editor: "这个编辑器应该在这页里面，不要更长，各自的地方各自scroll".
// The admin shell drops its gutters only for routes it knows are full-bleed editors; it knew
// /admin/edit-resume and not /admin/edit-master, so the master editor grew past the screen and the
// whole page scrolled. Geometry, not text: a squeezed or overflowing layout still renders every label.
//
// Owner again 2026-10-02, on his real master: "他现在需要scroll down一下才能看见底下". This spec had
// seeded one job and one skill: nothing was long enough to overflow, so it stayed green while a real
// résumé (six jobs, two schools, three skill sets → a long outline and canvas) pushed the page past
// the window. Both editors now load a résumé of that size.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import {
  contentWith, masterCard, openComposerFor, openDrafts, seedDraft, seedDraftContent, seedMaster,
} from '@/fixtures/resume-masters';

const OWNER = {
  email: 'composer-viewport@example.com', password: 'correct-horse-battery-staple',
  handle: 'composerviewport', fullName: 'Composer Viewport Owner',
};

// The owner's window (2026-10-02 screenshots, 1700 × ~1070): wide enough for Puck's three columns.
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password }, viewport: { width: 1700, height: 1000 } });
test.describe('résumé editors fit one screen', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the master editor: the page does not scroll, the editor ends inside the screen',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      await seedMaster(api, csrf, { name: 'Viewport', resume_content: fullResume() });
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
    await seedDraftContent(api, csrf, d.id, fullResume());
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
  // The editor itself (Puck's root, not just our wrapper) ends inside the window. Measured on the
  // owner's master 2026-10-02: Puck's root was one full window tall but started 141 px down, so its
  // bottom hung below the window and the admin content pane — not the document — scrolled.
  const bottom = await page.getByTestId('puck-resume-editor').evaluate((el) => {
    const root = el.querySelector('.Puck') ?? el;
    return root.getBoundingClientRect().bottom;
  });
  expect(bottom, 'the editor (Puck root) ends inside the window').toBeLessThanOrEqual((viewport?.height ?? 0) + 1);
  // The outline's last entry is reached by scrolling the outline's own panel; nothing the editor
  // sits in moves.
  const last = page.getByText('SkillSet', { exact: true }).last();
  await last.scrollIntoViewIfNeeded();
  await expect(last, 'the last outline entry can be scrolled to').toBeInViewport();
  const moved = await page.getByTestId('puck-resume-editor').evaluate((el) => {
    const out: string[] = [];
    for (let a = el.parentElement; a !== null; a = a.parentElement) {
      if (a.scrollTop > 0) out.push(`${a.tagName}.${a.className}`);
    }
    return out;
  });
  expect(moved, 'reaching it scrolled a panel, not anything around the editor').toEqual([]);
}

// fullResume —— the size of a real master: six jobs of four bullets, two schools, three skill sets,
// a cover letter. Long enough that a panel that does not scroll on its own overflows the window.
function fullResume(): ReturnType<typeof contentWith> {
  const job = (i: number) => ({
    title: `Engineer ${i}`, company: `Company ${i}`, location: 'Remote', period: { start: `20${10 + i}-01`, end: '' },
    bullets: [1, 2, 3, 4].map((b) => `Shipped thing ${b} at company ${i}, with a sentence long enough to wrap twice.`),
  });
  return {
    ...contentWith('VIEWPORTSUMMARY', 'A cover letter. '.repeat(40)),
    works: [1, 2, 3, 4, 5, 6].map(job),
    educations: [1, 2].map((i) => ({ school: `School ${i}`, degree: 'BSc', period: { start: '2008-09', end: '2012-06' } })),
    skills: ['Languages', 'Systems', 'Tools'].map((category) => ({ category, items: ['Go', 'TypeScript', 'Postgres'] })),
  };
}
