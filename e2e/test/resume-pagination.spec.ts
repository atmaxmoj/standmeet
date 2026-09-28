// resume-pagination.spec.ts —— a résumé longer than one page is laid out as pages, the same way in
// the editor canvas and in the PDF, and every page keeps its margins.
//
// What the owner hit (2026-09-28, a real 2-page résumé):
//   · the PDF ran text to within a few mm of the bottom edge of page 1, and started page 2 at the
//     top edge — only the whole document had padding, not each page;
//   · the editor canvas was ONE A4 sheet: everything past it overflowed off the paper, unreadable;
//   · Experience / Education / Skills had no section heading at all;
//   · the font-size setting changed the canvas but not the PDF;
//   · saving in the editor collapsed the skill categories into one.
//
// Criteria (each can go red):
//   1. the PDF is A4 (the paper the canvas draws); every page: first ink ≥ 10 mm from the top, last
//      ink ≥ 10 mm from the bottom, and the margins are cream paper, not white bands (measured on the
//      rasterized page — the ink, not the text layer);
//   2. the canvas shows as many sheets as the PDF has pages, and every unbreakable block lies inside
//      one sheet, within its top and bottom margins (geometry, not text);
//   3. the PDF carries each section heading exactly once;
//   4. a larger font size gives the same content more PDF pages;
//   5. saving in the editor keeps the skill categories.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { inspectPDF } from '@/fixtures/pdf-inspect';
import { near, rasterizePDFPage, type RasterPage } from '@/fixtures/pdf-raster';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'resume-pages@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumepages', fullName: 'Resume Pages Owner',
};
const MIN_MARGIN_MM = 10;
const A4_MM = 297;
const PAPER = { r: 0xf3, g: 0xef, b: 0xe6 };

const bullet = (n: number) =>
  `Delivered piece ${n} of the platform end to end, from the storage schema and the API through the ` +
  `release gates, and measured the result against the previous version before shipping it widely.`;

// longContent —— about two and a half pages at the default size: six roles of four long bullets,
// two schools, three skill categories, one custom section.
function longContent(fontScale = 1): Record<string, unknown> {
  return {
    identity: { name: 'Page Tester', email: 'pages@example.com', phone: '555-0100', location_line: 'Markham, ON', site: 'pages.example', links: [] },
    summary: 'Backend engineer. '.repeat(12),
    works: [1, 2, 3, 4, 5, 6].map((w) => ({
      title: `Software Engineer ${w}`, company: `Company ${w}`, location: 'Remote',
      period: { start: `201${w}-01`, end: `201${w + 1}-01` },
      bullets: [1, 2, 3, 4].map((b) => bullet(w * 10 + b)),
    })),
    educations: [
      { school: 'University One', degree: 'MSc Mathematics', period: { start: '2018-08', end: '2019-11' } },
      { school: 'University Two', degree: 'BS Mathematics', period: { start: '2014-09', end: '2018-05' } },
    ],
    skills: [
      { category: 'Languages', items: ['Go', 'TypeScript', 'Java'] },
      { category: 'Data', items: ['PostgreSQL', 'Redis', 'Kafka'] },
      { category: 'Infra', items: ['Docker', 'bubblewrap', 'GCP'] },
    ],
    social: [],
    custom: [{ label: 'Spoken', value: 'Mandarin (native), English (fluent)', kind: '' }],
    accent: '',
    font_scale: fontScale,
  };
}

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · pages, the same in the canvas and the PDF', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    draftID = await seed(api, csrf, longContent());
    await api.dispose();
  });

  test('every printed page keeps a top and a bottom margin', async ({ adminPage }) => {
    test.setTimeout(120_000);
    const pdf = await previewPDF(adminPage, draftID);
    const { pages, pageWidthPt, pageHeightPt } = await inspectPDF(pdf);
    // the default paper is US Letter, 612 × 792 pt (2 pt slack for rounding)
    expect(Math.abs(pageWidthPt - 612), `Letter width, got ${pageWidthPt} pt`).toBeLessThanOrEqual(2);
    expect(Math.abs(pageHeightPt - 792), `Letter height, got ${pageHeightPt} pt`).toBeLessThanOrEqual(2);
    expect(pages, 'the long résumé spans several pages').toBeGreaterThanOrEqual(2);
    for (let p = 1; p <= pages; p++) {
      const img = await rasterizePDFPage(pdf, p, 1.5);
      const { topMM, bottomMM } = inkMargins(img);
      expect(topMM, `page ${p}: space above the first line`).toBeGreaterThanOrEqual(MIN_MARGIN_MM);
      expect(bottomMM, `page ${p}: space below the last line`).toBeGreaterThanOrEqual(MIN_MARGIN_MM);
      // the margins are paper, not white bands: the sheet's four edges are cream
      for (const [x, y] of [[img.width / 2, 2], [img.width / 2, img.height - 3], [2, img.height / 2], [img.width - 3, img.height / 2]] as const) {
        expect(near(img.rgba(x, y), PAPER), `page ${p}: cream at the edge (${Math.round(x)}, ${Math.round(y)})`).toBe(true);
      }
    }
  });

  test('the canvas shows the PDF\'s pages, every block inside one page\'s margins', async ({ adminPage }) => {
    test.setTimeout(120_000);
    const { pages } = await inspectPDF(await previewPDF(adminPage, draftID));
    await openComposer(adminPage, draftID);
    await expectCanvasPages(adminPage, pages, 11 / 8.5);
  });

  test('A4 chosen: the PDF is A4 and the canvas draws A4 sheets, page for page', async ({ adminPage, playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const a4 = await seed(api, csrf, { ...longContent(), paper_size: 'a4' });
    await api.dispose();
    const { pages, pageWidthPt, pageHeightPt } = await inspectPDF(await previewPDF(adminPage, a4));
    expect(Math.abs(pageWidthPt - 595.3), `A4 width, got ${pageWidthPt} pt`).toBeLessThanOrEqual(2);
    expect(Math.abs(pageHeightPt - 841.9), `A4 height, got ${pageHeightPt} pt`).toBeLessThanOrEqual(2);
    await openComposer(adminPage, a4);
    await expectCanvasPages(adminPage, pages, 297 / 210);
  });

  test('each section is headed once in the PDF', async ({ adminPage }) => {
    const text = (await inspectPDF(await previewPDF(adminPage, draftID))).text.replace(/\s+/g, '').toUpperCase();
    for (const head of ['EXPERIENCE', 'EDUCATION', 'SKILLS']) {
      expect(text.split(head).length - 1, `one ${head} heading`).toBe(1);
    }
  });

  test('a larger font size gives the same content more PDF pages', async ({ adminPage, playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const big = await seed(api, csrf, longContent(1.25));
    await api.dispose();
    const normal = (await inspectPDF(await previewPDF(adminPage, draftID))).pages;
    const larger = (await inspectPDF(await previewPDF(adminPage, big))).pages;
    expect(larger, `font size 1.25 (${larger} pages) vs 1 (${normal} pages)`).toBeGreaterThan(normal);
  });

  test('saving in the editor keeps the skill categories', async ({ adminPage }) => {
    test.setTimeout(120_000);
    await openComposer(adminPage, draftID);
    const saved = adminPage.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/drafts/${draftID}`));
    await adminPage.getByTestId('puck-save').click();
    expect((await saved).status(), 'Save reached the backend').toBe(200);
    const res = await adminPage.request.get(`${BACKEND}/api/admin/drafts/${draftID}`);
    const skills = ((await res.json()) as { resume_content: { skills: { category: string }[] } }).resume_content.skills;
    expect(skills.map((s) => s.category)).toEqual(['Languages', 'Data', 'Infra']);
  });
});

async function seed(api: APIRequestContext, csrf: string, content: Record<string, unknown>): Promise<string> {
  const { id } = await createDraft(api, csrf, { company: 'Pages Inc', role: 'Engineer' });
  await updateDraft(api, csrf, id, { resume_content: content, template: '' });
  return id;
}

async function previewPDF(page: Page, id: string): Promise<Buffer> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return res.body();
}

async function openComposer(page: Page, id: string): Promise<void> {
  await page.getByTestId('admin-nav-drafts').click();
  const open = page.getByTestId(`draft-open-${id}`);
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
}

// expectCanvasPages —— the editor draws `pages` sheets in the paper's proportions (height/width =
// `ratio`), and every unbreakable block lies on one sheet, inside its top and bottom margins.
async function expectCanvasPages(page: Page, pages: number, ratio: number): Promise<void> {
  const canvas = page.frameLocator('iframe').first();
  const sheets = canvas.locator('[data-resume-sheet]');
  await expect(sheets, 'one sheet per printed page').toHaveCount(pages, { timeout: 30_000 });
  const boxes = await sheets.evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }));
  for (const b of boxes) {
    expect(Math.abs(b.height / b.width - ratio), `sheet proportions ${b.height / b.width} vs ${ratio}`).toBeLessThan(0.01);
  }
  const atoms = await canvas.locator('[data-atom]').evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, text: (e.textContent ?? '').slice(0, 40) };
  }));
  expect(atoms.length, 'the résumé\'s blocks rendered').toBeGreaterThan(20);
  for (const a of atoms) {
    const home = boxes.find((s) => a.top >= s.top && a.top < s.bottom);
    expect(home, `"${a.text}" sits on a sheet`).toBeDefined();
    const margin = home!.width * 0.06; // the pages' margin is 6.5% of the width; 0.06 absorbs rounding
    expect(a.top, `"${a.text}" clears the sheet's top margin`).toBeGreaterThanOrEqual(home!.top + margin);
    expect(a.bottom, `"${a.text}" ends above the sheet's bottom margin`).toBeLessThanOrEqual(home!.bottom - margin);
  }
}

// inkMargins —— the blank space above the first and below the last row carrying ink (any pixel far
// from the paper colour), in millimetres of an A4 page.
function inkMargins(img: RasterPage): { topMM: number; bottomMM: number } {
  const ink = (y: number) => {
    for (let x = 0; x < img.width; x += 2) {
      const p = img.rgba(x, y);
      if (Math.abs(p.r - PAPER.r) + Math.abs(p.g - PAPER.g) + Math.abs(p.b - PAPER.b) > 60) return true;
    }
    return false;
  };
  let top = 0;
  while (top < img.height && !ink(top)) top++;
  let bottom = img.height - 1;
  while (bottom > top && !ink(bottom)) bottom--;
  const mm = (px: number) => (px / img.height) * A4_MM;
  return { topMM: mm(top), bottomMM: mm(img.height - 1 - bottom) };
}
