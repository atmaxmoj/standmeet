// resume-accent-fontscale.spec.ts — the whole-résumé root controls actually reach the render.
//
// accent colour and font-size scale were persisted into resume_content but the renderer ignored them
// (a dead control — the audit's 🔴). They are now applied as CSS variables on the paper: the accent
// overrides --color-accent for every accented element, and --resume-scale multiplies every font size
// (text-[calc(Npx*var(--resume-scale))]). Both are probed on the section-heading element, which uses
// both (accent colour + a scaled size).
//
// RED without the wiring: the head colour would be the theme vermillion and its size the un-scaled
// 10px, regardless of what the owner set.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'resume-knobs@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumeknobs', fullName: 'Resume Knobs Owner',
};

const ACCENT = '#2244cc';          // a distinct accent, not the theme vermillion
const ACCENT_RGB = 'rgb(34, 68, 204)';
const SCALE = 2;                   // font-size doubled

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · the accent + font-scale root controls reach the render', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('a custom accent recolours the section heading, and the font scale multiplies its size',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      await openComposer(page, id);
      const head = page.frameLocator('iframe').first().locator('[data-sec-head]').first();
      await expect(head, 'a section heading rendered (it carries both knobs)').toBeVisible({ timeout: 30_000 });

      // accent → the heading's computed colour follows the owner's accent (not the theme default).
      const color = await head.evaluate((el) => getComputedStyle(el).color);
      expect(color, 'section heading uses the owner accent colour').toBe(ACCENT_RGB);

      // fontScale=2 → the heading (text-[calc(10px*var(--resume-scale))]) renders at 20px.
      const size = await head.evaluate((el) => getComputedStyle(el).fontSize);
      expect(size, 'section heading size is scaled by font-scale (10px × 2)').toBe('20px');

      await api.dispose();
    });
});

async function openComposer(page: Page, id: string): Promise<void> {
  await page.getByTestId('admin-nav-drafts').click();
  const open = page.getByTestId(`draft-open-${id}`);
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
}

// seed — a draft whose resume_content sets the accent + font_scale knobs, with a summary so a section
// heading (which uses both) renders.
async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Northwind', role: 'Staff Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: {
      name: 'Ada Knobs', email: 'ada@example.com', phone: '', location_line: '', site: '', links: [],
    },
    summary: 'A summary so the résumé renders a section heading.',
    works: [], educations: [], skills: [], social: [], custom: [],
    accent: ACCENT, font_scale: SCALE,
  };
  const res = await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  expect(res.status(), 'seed resume_content with accent + font_scale').toBeLessThan(300);
  return id;
}
