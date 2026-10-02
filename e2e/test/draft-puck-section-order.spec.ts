// draft-puck-section-order.spec.ts —— Q0 Group A2 (arranged order): a section arrangement must
// render in THAT order in the committed Typst PDF, end to end. This is the "moving sections actually
// moves them" guard at the artifact level: it renders one draft with works [ALPHA, BETA] and another
// with the reverse [BETA, ALPHA], and asserts the PDF text order flips. If any layer stopped honouring
// arrangement — fromPuckData regrouping, the backend, or the typst template sorting — one of the two
// positional assertions goes RED. (The editor→data half is guarded by resume-puck U3/U4;
// composer-pdf-fidelity proves every field reaches the PDF; this proves ORDER does.)
//
// Why order matters even when it "looks the same": a résumé with the same entries in a different
// order is a different document; only an order-asserting test protects a future change from silently
// reshuffling it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { openReader } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-order@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckorder', fullName: 'Puck Order Owner',
};
const ALPHA = 'ALPHAORGZZ';
const BETA = 'BETAORGZZ';

let forwardID = '';
let reverseID = '';
let dragID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · a section arrangement renders in that order in the PDF (Q0 A2)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    forwardID = await seedWithOrder(api, csrf, [ALPHA, BETA]);
    reverseID = await seedWithOrder(api, csrf, [BETA, ALPHA]);
    dragID = await seedWithOrder(api, csrf, [ALPHA, BETA]);
    await api.dispose();
  });

  test('works arranged [ALPHA, BETA] render ALPHA before BETA', async ({ adminPage }) => {
    const text = await pdfText(adminPage, forwardID);
    const a = text.indexOf(ALPHA);
    const b = text.indexOf(BETA);
    expect(a, 'ALPHA present').toBeGreaterThanOrEqual(0);
    expect(b, 'BETA present').toBeGreaterThanOrEqual(0);
    expect(a, 'ALPHA renders before BETA in the arranged order').toBeLessThan(b);
  });

  test('the reverse arrangement [BETA, ALPHA] flips the PDF order', async ({ adminPage }) => {
    const text = await pdfText(adminPage, reverseID);
    const a = text.indexOf(ALPHA);
    const b = text.indexOf(BETA);
    expect(b, 'BETA present').toBeGreaterThanOrEqual(0);
    expect(a, 'ALPHA present').toBeGreaterThanOrEqual(0);
    expect(b, 'reversing the arrangement renders BETA before ALPHA').toBeLessThan(a);
  });

  // The owner's own gesture (2026-10-02: "Puck 编辑器真拖拽…这个没做么"): the tests above set the
  // order in data; nothing ever dragged. Here a real pointer picks BETA up on the canvas, carries it
  // above ALPHA and lets go; Save; the stored order and the PDF both follow.
  test('dragging BETA above ALPHA on the canvas reorders the résumé', async ({ adminPage: page }) => {
    test.setTimeout(120_000);
    await openReader(page, `/admin/edit-resume/${dragID}`);
    const canvas = page.frameLocator('iframe');
    const alpha = canvas.locator('[data-puck-component]').filter({ hasText: ALPHA });
    const beta = canvas.locator('[data-puck-component]').filter({ hasText: BETA });
    await expect(beta, 'BETA is on the canvas').toBeVisible({ timeout: 30_000 });
    await dragAbove(page, beta, alpha);
    await expect.poll(async () => order(page), { message: 'the canvas shows BETA first', timeout: 10_000 })
      .toEqual([BETA, ALPHA]);
    await page.getByTestId('puck-save').click();
    await expect.poll(async () => storedOrder(page, dragID), { message: 'Save stored the dragged order', timeout: 15_000 })
      .toEqual([BETA, ALPHA]);
    const text = await pdfText(page, dragID);
    expect(text.indexOf(BETA), 'the PDF follows the drag').toBeLessThan(text.indexOf(ALPHA));
  });
});

// dragAbove —— a person's drag. Wait until the canvas is ready: Puck's loader strip lies over the
// canvas while it loads and takes the press (measured 2026-10-02: the pointerdown landed on
// `_PuckCanvas-loader`, the iframe never saw it). Then press and hold, creeping a pixel at a time —
// Puck picks a block up after a 200 ms hold within 10 px, then 5 px of travel — until the block is
// picked up; carry it above `target`; release.
async function dragAbove(page: Page, item: Locator, target: Locator): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const loader = document.querySelector('[class*="PuckCanvas-loader"]');
    return loader === null ? 0 : loader.getBoundingClientRect().height;
  }), { message: 'the canvas finished loading', timeout: 30_000 }).toBe(0);
  const from = await item.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('drag: a block is not laid out');
  const x = from.x + from.width / 2;
  let y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Once picked up, dnd-kit leaves a placeholder copy in the list, so the block is matched by its
  // dragging mark rather than by its text.
  const dragging = page.frameLocator('iframe').locator('[data-dnd-dragging="true"]');
  await expect.poll(async () => {
    y -= 1;
    await page.mouse.move(x, y);
    return dragging.count();
  }, { message: 'the block was picked up', timeout: 10_000, intervals: [100] }).toBeGreaterThan(0);
  await page.mouse.move(x, to.y + 4, { steps: 25 });
  await page.mouse.up();
}

// order —— the experience blocks as the canvas shows them, top to bottom.
async function order(page: Page): Promise<string[]> {
  const texts = await page.frameLocator('iframe').locator('[data-puck-component^="Experience"]').allTextContents();
  return texts.map((t) => (t.includes(ALPHA) ? ALPHA : t.includes(BETA) ? BETA : '?'));
}

async function storedOrder(page: Page, id: string): Promise<string[]> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}`);
  const body = await res.json() as { resume_content: { works: Array<{ company: string }> } };
  return body.resume_content.works.map((w) => w.company);
}

async function pdfText(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text;
}

async function seedWithOrder(api: APIRequestContext, csrf: string, order: [string, string]): Promise<string> {
  const { id } = await createDraft(api, csrf, { company: 'Acme', role: 'Engineer' });
  const work = (company: string, start: string) => ({
    company, title: 'Engineer', location: '', period: { start, end: null }, bullets: [`did ${company}`],
  });
  const resume_content = {
    identity: { name: 'R', email: 'r@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'a summary',
    works: [work(order[0], '2022-01'), work(order[1], '2020-01')],
    educations: [], skills: [], social: [], custom: [], accent: '',
  };
  await updateDraft(api, csrf, id, { resume_content, template: '' });
  return id;
}
