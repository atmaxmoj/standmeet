// resume-composer-fidelity.spec.ts —— the composer must render EVERY section type the draft has, as a
// distinct on-canvas block carrying that section's real content — with no client-side exception.
//
// Why this exists: the id-collision bug (fixed in "give every Puck component a unique id") collapsed
// all sections into duplicates of one and crashed the editor. resume-composer-sections guards the
// no-works shape (Header/Summary/Education/SkillSet), but Experience / Social / Custom were never
// asserted to render on the canvas at all — so a collapse or a bad render of those three would ship
// unseen ([[test-covers-capability-not-face]]). This seeds a résumé with ALL SEVEN section types and
// checks each renders distinctly with its own data. It's the "editor faithfully shows the draft"
// guard — the exact thing the owner hit as "编辑和预览对不上".

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, FrameLocator } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { openReader } from '@/fixtures/navigate';
const OWNER = {
  email: 'puck-fidelity@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckfidelity', fullName: 'Puck Fidelity Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('the composer renders every section type faithfully (Q0)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('a full résumé (all 7 section types) opens with each type distinct, in place, no crash',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seed(api, csrf);

      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await openReader(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      const canvas: FrameLocator = page.frameLocator('iframe').first();

      // Every section type renders as its own tagged block, in the counts the résumé actually has —
      // if any type collapsed into another, or duplicated, these counts break.
      await expect(canvas.locator('[data-sec="header"]')).toHaveCount(1);
      await expect(canvas.locator('[data-sec="summary"]')).toHaveCount(1);
      await expect(canvas.locator('[data-sec="experience"]'), 'both roles').toHaveCount(2);
      await expect(canvas.locator('[data-sec="education"]')).toHaveCount(1);
      // The composer's DraftModel flattens all skill categories into one anonymous category by design
      // (draft-model.ts), so one SkillSet block carries every skill — not one per seeded category.
      await expect(canvas.locator('[data-sec="skillset"]'), 'skills collapse to one category by design').toHaveCount(1);
      await expect(canvas.locator('[data-sec="social"]')).toHaveCount(1);
      // Custom: one label+value section + one divider (both tagged data-sec="custom").
      await expect(canvas.locator('[data-sec="custom"]')).toHaveCount(2);

      // Each type shows ITS OWN distinctive content (proves it's the draft's data on the right block,
      // not one placeholder duplicated). One text per section type, unique to that type.
      await expect(canvas.getByText('Ada Lovelace', { exact: false }), 'header name').toBeVisible();
      await expect(canvas.getByText('the summary line', { exact: false }), 'summary').toBeVisible();
      await expect(canvas.getByText('Northwind', { exact: false }), 'experience company').toBeVisible();
      await expect(canvas.getByText('State University', { exact: false }), 'education school').toBeVisible();
      await expect(canvas.getByText('Rust', { exact: false }), 'skillset item').toBeVisible();
      await expect(canvas.getByText('@ada', { exact: false }), 'social handle').toBeVisible();
      await expect(canvas.getByText('Distinguished Award', { exact: false }), 'custom value').toBeVisible();

      expect(pageErrors, 'no client-side exception opening a full résumé').toEqual([]);
      await api.dispose();
    });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const { id } = await createDraft(api, csrf, { company: 'Acme', role: 'Engineer' });
  const resume_content = {
    identity: { name: 'Ada Lovelace', email: 'ada@ex.io', phone: '', location_line: 'Remote', site: '', links: [] },
    summary: 'the summary line',
    works: [
      { title: 'Staff Eng', company: 'Northwind', location: 'Remote', period: { start: '2020', end: null }, bullets: ['shipped it'] },
      { title: 'Engineer', company: 'Acme', location: 'NYC', period: { start: '2017', end: '2020' }, bullets: ['built it'] },
    ],
    educations: [
      { school: 'State University', degree: 'BSc', period: { start: '2013', end: '2017' } },
    ],
    skills: [
      { category: 'Languages', items: ['Rust', 'Go'] },
      { category: 'Tools', items: ['Docker'] },
    ],
    social: [{ kind: 'github', label: 'GitHub', handle: '@ada' }],
    custom: [
      { label: 'Certifications', value: 'Distinguished Award', kind: '' },
      { label: '', value: '', kind: 'divider' },
    ],
    accent: '',
  };
  await updateDraft(api, csrf, id, { resume_content, template: '' });
  return id;
}
