// resume-composer-sections.spec.ts —— the composer must render a draft's sections as DISTINCT Puck
// components, and must not throw a client-side exception on open.
//
// The bug (sijie, v0.1.26): a draft whose puck_data is null derives its editor doc from
// resume_content via toPuckData — which emitted components with NO props.id. Puck keys its component
// store by props.id, so every id-less item collided on `undefined`: the canvas rendered duplicates of
// one section (owner saw "all SkillSet" while the PDF showed Header/Summary/Education), and selecting/
// editing threw "Application error: a client-side exception has occurred" (the white-screen composer).
//
// This drives the REAL Puck editor on the exact shape that broke (identity + summary + two educations
// + one skill, no works) and asserts: (1) no pageerror fires, (2) the iframe canvas holds one Header,
// one Summary, TWO Education and one SkillSet section — i.e. the components did not collapse into one.
// On the id-less code both assertions fail. ([[test-covers-capability-not-face]]: draft-puck-paper
// only checked the paper colour, so this class of collapse slipped through.)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-sections@example.com', password: 'correct-horse-battery-staple',
  handle: 'pucksections', fullName: 'Puck Sections Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the composer renders draft sections as distinct components (Q0)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('a no-works draft opens with one Header/Summary/SkillSet + two Education — not collapsed, no crash',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      // Capture any client-side exception (the white-screen symptom) — registered BEFORE navigation.
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      const canvas = page.frameLocator('iframe').first();
      // The five sections render as distinct on-canvas blocks, each tagged data-sec by the config.
      await expect(canvas.locator('[data-sec="header"]'), 'exactly one Header').toHaveCount(1);
      await expect(canvas.locator('[data-sec="summary"]'), 'exactly one Summary').toHaveCount(1);
      await expect(canvas.locator('[data-sec="education"]'), 'both educations, not collapsed').toHaveCount(2);
      await expect(canvas.locator('[data-sec="skillset"]'), 'exactly one SkillSet').toHaveCount(1);
      // The real content is on screen (the education schools), proving it's the draft's data, not one
      // duplicated placeholder.
      await expect(canvas.getByText('cwdvae', { exact: false })).toBeVisible();
      await expect(canvas.getByText('ca dca d', { exact: false })).toBeVisible();

      // The canvas is an A4 sheet: for this short résumé the paper holds A4 proportions (210:297).
      const paper = canvas.locator('.sm-resume-paper').first();
      const box = await paper.boundingBox();
      expect(box, 'the paper sheet has a box').not.toBeNull();
      const ratio = box!.width / box!.height;
      expect(Math.abs(ratio - 210 / 297), `paper is A4-proportioned (got ${ratio.toFixed(3)})`).toBeLessThan(0.04);

      // Section headings render in the accent (the typst "红色 title"): #B5391C = rgb(181, 57, 28).
      const headColor = await canvas.locator('[data-sec-head]').first()
        .evaluate((el) => getComputedStyle(el).color);
      expect(headColor, 'section headings are accent-red').toBe('rgb(181, 57, 28)');

      expect(pageErrors, 'the composer opens with no client-side exception').toEqual([]);
      await api.dispose();
    });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  // The exact shape that broke on sijie (draft 0533bda3): no works; two educations; one skill set.
  const resume_content = {
    identity: { name: 'E', email: 'e@e.io', phone: '', location_line: 'Remote', site: '', links: [] },
    summary: '就过来看过来',
    works: [],
    educations: [
      { school: 'cwdvae', degree: '', period: { start: '', end: null } },
      { school: 'ca dca d', degree: 'v sad', period: { start: '', end: null } },
    ],
    skills: [{ category: '', items: ['x'] }],
    social: [], custom: [], accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
