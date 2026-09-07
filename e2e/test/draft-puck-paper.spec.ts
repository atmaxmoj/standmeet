// draft-puck-paper.spec.ts —— the résumé canvas is a DOCUMENT: it renders in its OWN fixed paper
// palette (cream + ink, like the typst PDF), NOT the editor's day/night. The editor chrome follows
// the theme; the document does not. Regression for the dark-mode bug where the résumé rendered
// dark-on-dark and looked blank. (owner: "pdf 需要就是自己的颜色，你搞反了".)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-paper@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckpaper', fullName: 'Puck Paper Owner',
};
const CREAM = 'rgb(243, 239, 230)'; // #F3EFE6 — the fixed résumé paper background

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé canvas is fixed paper, not the editor theme (Q0)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('with the editor in DARK mode, the résumé canvas is still cream paper', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const id = await seed(api, csrf);

    // Put the editor in dark mode BEFORE the composer loads (the owner's real state), so Puck's iframe
    // is created dark too — setting .dark after mount doesn't reach the already-built iframe.
    await page.addInitScript(() => {
      try { window.localStorage.setItem('standmeet-dark', '1'); } catch { /* private mode */ }
    });
    await goto(page, `/admin/edit-resume/${id}`);
    await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

    const paper = page.frameLocator('iframe').first().locator('.sm-resume-paper').first();
    await expect(paper, 'the résumé canvas has a paper scope').toBeVisible({ timeout: 15_000 });

    const seen = await paper.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      // the editor really is dark (so cream below is DESPITE the dark theme, not the absence of it)
      frameDark: el.ownerDocument.documentElement.classList.contains('dark'),
    }));
    expect(seen.frameDark, 'precondition: the editor canvas is in dark mode').toBe(true);
    expect(seen.bg, 'the résumé paper stays the fixed cream even though the editor is dark').toBe(CREAM);
    await api.dispose();
  });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'Sijie Wang', email: 's@ex.io', phone: '', location_line: 'Remote', site: '', links: [] },
    summary: 'A backend engineer.', works: [
      { company: 'Northwind', title: 'Senior Engineer', location: 'Remote', period: { start: '2021', end: null }, bullets: ['shipped it'] },
    ],
    educations: [], skills: [{ category: 'Languages', items: ['Go', 'TypeScript'] }],
    social: [], custom: [], accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
