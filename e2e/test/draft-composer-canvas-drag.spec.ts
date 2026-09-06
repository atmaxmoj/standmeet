// draft-composer-canvas-drag.spec.ts —— reorder experience rows by dragging ON THE CANVAS (P3-b),
// with a REAL pointer gesture. The owner asked for exactly this ("不是拖拽改变布局 … typst 一定要真的
// pw 拖拽,然后看是否拖拽成功") — the canvas had only edit pencils, no way to drag the layout.
//
// The template emits a row-anchor per experience row; the live WASM preview overlays a grip at each;
// dragging one grip onto another reorders the list (recompile + persist). This drives it with real
// page.mouse.down/move/up on the grips (the overlay uses pointer capture, not HTML5 DnD, so a raw
// mouse drag IS the interaction) and proves it SUCCEEDED by reading the reordered artifact: the
// rendered PDF lists the experience in the new order.
//
// RED without P3-b: there is no `composer-row-drag-works-*` grip to grab.

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

let draftID = '';

async function centerDrag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error('drag handles have no box');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // move in steps so the drag reads as a real gesture, ending over the target grip
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · drag rows on the canvas to reorder (P3-b)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('drag Beta grip onto Alpha on the canvas → order flips in the rendered PDF', async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    // Two experience rows, distinct companies (the template renders company, so they show on canvas).
    await page.getByTestId('composer-panel-experience').click();
    await page.getByTestId('composer-exp-add').click();
    await page.getByTestId('composer-exp-org-e-new-0').fill('CanvasAlpha');
    await page.getByTestId('composer-exp-add').click();
    await page.getByTestId('composer-exp-org-e-new-1').fill('CanvasBeta');

    // Live preview renders; its grips sit at each row.
    const svgBox = page.getByTestId('composer-preview-svg');
    await expect(svgBox).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
    const alpha = page.getByTestId('composer-row-drag-works-0');
    const beta = page.getByTestId('composer-row-drag-works-1');
    await expect(alpha, 'a grip per experience row').toBeVisible();
    await expect(beta).toBeVisible();

    // Real gesture: drag Beta's grip up onto Alpha's row.
    await centerDrag(page, beta, alpha);

    // Save settles, then the rendered PDF proves the drag SUCCEEDED — Beta now renders before Alpha.
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });
    const res = await page.request.get(`${BACKEND}/api/admin/drafts/${draftID}/preview.pdf`);
    expect(res.status()).toBe(200);
    const { text } = await inspectPDF(await res.body());
    expect(text.indexOf('CanvasBeta'), 'Beta is in the PDF').toBeGreaterThanOrEqual(0);
    expect(text.indexOf('CanvasBeta'), 'Beta renders before Alpha after the canvas drag')
      .toBeLessThan(text.indexOf('CanvasAlpha'));
  });
});

async function seedDraft(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  const id = (await res.json() as { id: string }).id;
  await request.dispose();
  return id;
}
