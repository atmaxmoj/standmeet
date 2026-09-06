// draft-composer-canvas-drag.spec.ts —— reorder rows by dragging ON THE CANVAS (P3-b), the composer's
// layout interaction (owner: editing is the left panel; the canvas is DRAG). Real pointer gestures,
// and every case asserts the resulting order in the RENDERED PDF — the artifact, not component state.
//
// Covers the various drags: experience dragged UP, experience dragged DOWN, a three-row drag to the
// top (+ persist on reopen), and education reorder. Dropping a row's grip onto another row's grip
// moves it to that row's slot (direction-agnostic — the grips carry the row's array index).
//
// Content is PATCHed in directly (not typed row-by-row) so each draft has EXACTLY the rows under test
// — manual drafts otherwise seed from the newest prior draft, which would make row indices drift.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Page, Locator } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'canvas-drag@example.com', password: 'correct-horse-battery-staple',
  handle: 'canvasdrag', fullName: 'Canvas Drag Owner',
};

interface Content { works?: string[]; educations?: string[] }

// dragGrip —— a real pointer gesture from one grip to another (pointer capture drives it, not HTML5
// DnD), ending centred on the target grip.
async function dragGrip(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error('a drag grip has no box');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function pdfIndexOf(page: Page, id: string, marker: string): Promise<number> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text.indexOf(marker);
}

async function openPreviewReady(page: Page, id: string): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.getByTestId(`draft-open-${id}`).first().click();
  await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('composer-preview-svg'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · drag rows on the canvas to reorder (P3-b)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('experience dragged UP: row 1 grip onto row 0 → row 1 first in the PDF', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright, { works: ['AlphaUp', 'BetaUp'] });
    await openPreviewReady(page, id);

    await dragGrip(page, page.getByTestId('composer-row-drag-works-1'), page.getByTestId('composer-row-drag-works-0'));
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    expect(await pdfIndexOf(page, id, 'BetaUp'), 'Beta before Alpha')
      .toBeLessThan(await pdfIndexOf(page, id, 'AlphaUp'));
  });

  test('experience dragged DOWN: row 0 grip onto row 1 → row 1 first in the PDF', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright, { works: ['AlphaDn', 'BetaDn'] });
    await openPreviewReady(page, id);

    await dragGrip(page, page.getByTestId('composer-row-drag-works-0'), page.getByTestId('composer-row-drag-works-1'));
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    expect(await pdfIndexOf(page, id, 'BetaDn'), 'Beta before Alpha after dragging Alpha down')
      .toBeLessThan(await pdfIndexOf(page, id, 'AlphaDn'));
  });

  test('three rows: drag the last to the top → Gamma first, and it persists on reopen', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright, { works: ['AlphaTri', 'BetaTri', 'GammaTri'] });
    await openPreviewReady(page, id);

    await dragGrip(page, page.getByTestId('composer-row-drag-works-2'), page.getByTestId('composer-row-drag-works-0'));
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    const gi = await pdfIndexOf(page, id, 'GammaTri');
    expect(gi, 'Gamma before Alpha').toBeLessThan(await pdfIndexOf(page, id, 'AlphaTri'));
    expect(gi, 'Gamma before Beta').toBeLessThan(await pdfIndexOf(page, id, 'BetaTri'));

    // Reopen — the new order is what got saved, not just local state.
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${id}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('composer-panel-experience').click();
    await expect(page.locator('[data-testid^="composer-exp-row-"]').first().locator('input').first(),
      'Gamma persisted as the first row').toHaveValue('GammaTri');
  });

  test('education rows reorder by canvas drag too', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright, { educations: ['AlphaSchool', 'BetaSchool'] });
    await openPreviewReady(page, id);

    await dragGrip(page, page.getByTestId('composer-row-drag-educations-1'), page.getByTestId('composer-row-drag-educations-0'));
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    expect(await pdfIndexOf(page, id, 'BetaSchool'), 'Beta school before Alpha after the drag')
      .toBeLessThan(await pdfIndexOf(page, id, 'AlphaSchool'));
  });
});

// seed —— create a draft and PATCH it to EXACTLY the given rows (companies / schools as the markers),
// so the drag targets `works-<i>` / `educations-<i>` are deterministic.
async function seed(playwright: Playwright, c: Content): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const created = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(created.status(), 'seed draft').toBeLessThan(300);
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'Drag Tester', email: 'd@x.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'drag test',
    works: (c.works ?? []).map((company) => ({
      company, title: 'Engineer', location: 'Remote', period: { start: '2020-01', end: '2021-01' }, bullets: ['did things'],
    })),
    educations: (c.educations ?? []).map((school) => ({
      school, degree: 'BS', period: { start: '2014-09', end: '2018-05' },
    })),
    skills: [{ category: '', items: ['x'] }], social: [], custom: [],
  };
  const patch = await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  expect(patch.status(), 'seed content').toBeLessThan(300);
  await request.dispose();
  return id;
}
