// draft-composer-layout-drag.spec.ts —— Spec 2's on-canvas LAYOUT gestures: drag a whole left-rail
// SECTION to reorder it, and drag the column DIVIDER to rebalance the two columns. Real pointer
// gestures (owner: "typst 一定要真的 pw 拖拽"), and each asserts the RESULT on the artifact — the
// rendered PDF's section order, and the moved boundary + the persisted left_width — not just state.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Page, Locator } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'layout-drag@example.com', password: 'correct-horse-battery-staple',
  handle: 'layoutdrag', fullName: 'Layout Drag Owner',
};

// dragGrip —— a real pointer gesture from one grip's centre to another's (pointer capture, not DnD).
async function dragGrip(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error('a drag grip has no box');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

// dragBy —— press a handle and move the pointer by (dx, dy), then release (for the divider, which is
// not dropped onto another element but dragged a distance).
async function dragBy(page: Page, handle: Locator, dx: number): Promise<void> {
  const box = await handle.boundingBox();
  if (box === null) throw new Error('divider handle has no box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 10 });
  await page.mouse.up();
}

async function pdfIndexOf(page: Page, id: string, marker: string): Promise<number> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text.indexOf(marker);
}

async function storedLeftWidth(page: Page, id: string): Promise<number> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}`);
  expect(res.status(), 'draft detail').toBe(200);
  const d = await res.json() as { resume_content: { left_width?: number } };
  return d.resume_content.left_width ?? 0;
}

async function openPreviewReady(page: Page, id: string): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.getByTestId(`draft-open-${id}`).first().click();
  await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('composer-preview-svg'))
    .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · drag the layout on the canvas (Spec 2)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('drag a left-rail section (custom → top) → it prints first in the PDF', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright);
    await openPreviewReady(page, id);
    // Default left order is skills(0) · education(1) · custom(2). Drag custom's grip onto skills'.
    await dragGrip(page,
      page.getByTestId('composer-row-drag-left-2'), page.getByTestId('composer-row-drag-left-0'));
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    const ci = await pdfIndexOf(page, id, 'CERTMARK');
    expect(ci, 'custom section moved above skills').toBeLessThan(await pdfIndexOf(page, id, 'SKILLS'));
    expect(ci, 'custom section moved above education')
      .toBeLessThan(await pdfIndexOf(page, id, 'EDUCATION'));
  });

  test('drag the column divider right → the boundary moves and left_width persists', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright);
    await openPreviewReady(page, id);

    const before = await page.getByTestId('composer-col-divider').boundingBox();
    if (before === null) throw new Error('no divider box');
    await dragBy(page, page.getByTestId('composer-col-divider'), 140);
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });
    await expect(page.getByTestId('composer-preview-svg'))
      .toHaveAttribute('data-status', 'ready', { timeout: 90_000 });

    // The boundary moved right (the artifact re-laid-out), and the wider left column persisted.
    const after = await page.getByTestId('composer-col-divider').boundingBox();
    if (after === null) throw new Error('no divider box after drag');
    expect(after.x, 'divider moved right').toBeGreaterThan(before.x);
    expect(await storedLeftWidth(page, id), 'wider left column persisted').toBeGreaterThan(0.9);
  });
});

// seed —— a draft with all three left-rail sections present (skills / education / custom), so all
// three section grips exist and the custom heading (CERTMARK) is a unique marker to track its order.
async function seed(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const created = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(created.status(), 'seed draft').toBeLessThan(300);
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'Layout Tester', email: 'l@x.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'layout test',
    works: [{
      company: 'Acme', title: 'Engineer', location: 'Remote',
      period: { start: '2020-01', end: '2021-01' }, bullets: ['shipped the thing end to end'],
    }],
    educations: [{ school: 'State U', degree: 'BS', period: { start: '2014-09', end: '2018-05' } }],
    skills: [{ category: 'Langs', items: ['Go'] }],
    custom: [{ label: 'CertMark', value: 'AWS SAA', kind: '' }],
  };
  const patch = await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  expect(patch.status(), 'seed content').toBeLessThan(300);
  await request.dispose();
  return id;
}
