// mermaid-follows-the-theme.spec.ts —— BLACK BOX. A mermaid diagram draws in the page's colors,
// in both modes, and follows a theme switch without a reload.
//
// Found 2026-10-18 while moving the renderer to Pele: the old renderer baked one cream palette
// into every SVG (mermaid themeVariables, "no dark switch"), so on a dark page a diagram was a
// bright cream box with near-black labels, and the reader's theme toggle left it as it was.
//
// Contract:
//   - In dark mode a diagram's labels take the page ink, and its node boxes are not bright.
//   - Switching the theme on the reader recolors a diagram already on the page.
//   - A chart's first series is the page accent (prod, v0.1.160: Pele's default series palette
//     drew the owner's bar charts in Tableau blue — the one color the design language rules out).

import type { Locator } from '@playwright/test';

import { test, expect, type Page } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'mermaid-theme@example.com', password: 'correct-horse-battery-staple',
  handle: 'mermaidtheme', fullName: 'Mermaid Theme Owner',
};
const PATH = 'theme-diagram';
const BODY = 'Some text.\n\n```mermaid\nflowchart LR\n  A[Alpha] --> B[Beta]\n```\n';
const CHART = 'theme-chart';
const CHART_BODY = '```mermaid\nxychart-beta\n  x-axis [a, b]\n  bar [3, 5]\n```\n';

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'mermaid-theme');
  const sid = await initMCP(request, token);
  for (const [path, body] of [[PATH, BODY], [CHART, CHART_BODY]] as const) {
    const { wikiID } = await seedWiki(request, token, sid, { title: path, path, body });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID, excerpt: 'A diagram.' });
  }
  await request.dispose();
});

// diagram —— the drawn SVG on the reader page, once it is there.
async function diagram(page: Page): Promise<Locator> {
  const svg = page.getByTestId('wiki-body').getByTestId('mermaid-svg').locator('svg').first();
  await expect(svg).toBeVisible({ timeout: 30_000 });
  return svg;
}

// pageInk —— the color the page's own prose is in.
const pageInk = (page: Page): Promise<string> => page.getByTestId('wiki-body')
  .getByText('Some text.').evaluate((el) => getComputedStyle(el).color);

// labelInk —— the color a reader sees the node label in (SVG text paints with fill, HTML with color).
const labelInk = (svg: Locator): Promise<string> => svg.getByText('Alpha').first()
  .evaluate((el) => (el instanceof SVGElement ? getComputedStyle(el).fill : getComputedStyle(el).color));

// brightestBox —— the luminance (0–255) of the brightest node-sized box in the diagram.
const brightestBox = (svg: Locator): Promise<number> => svg.evaluate((root) => {
  const c = document.createElement('canvas'); c.width = 1; c.height = 1;
  const ctx = c.getContext('2d');
  const lum = (color: string): number => {
    if (ctx === null || color === 'none') return 0;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return (r + g + b) / 3;
  };
  return Math.max(0, ...[...root.querySelectorAll('rect')]
    .filter((r) => r.getBoundingClientRect().width > 20)
    .map((r) => lum(getComputedStyle(r).fill)));
});

// labelFits —— the label's drawn width against what holds it: an HTML label's foreignObject (which
// clips), else its node's shape.
const labelFits = (svg: Locator): Promise<{ label: number; box: number }> => svg.getByText('Alpha')
  .first().evaluate((el) => {
    const shape = ':scope > :is(rect, path, polygon)';
    let g: Element | null = el.parentElement;
    while (g !== null && g.querySelector(shape) === null) g = g.parentElement;
    const holder = el.closest('foreignObject') ?? g?.querySelector(shape);
    const range = document.createRange(); range.selectNodeContents(el);
    return { label: range.getBoundingClientRect().width, box: holder?.getBoundingClientRect().width ?? 0 };
  });

test('in dark mode a diagram draws in the page ink, on dark boxes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openReader(page, `/wiki/${PATH}`);
  const svg = await diagram(page);
  expect(await labelInk(svg), 'the labels take the page ink').toBe(await pageInk(page));
  expect(await brightestBox(svg), 'no bright box on a dark page').toBeLessThan(90);
});

// The same run's screenshot: the boxes read "Alph" and "Bet" — measured in one font, drawn in another.
test('a label fits inside its box', async ({ page }) => {
  await openReader(page, `/wiki/${PATH}`);
  const { label, box } = await labelFits(await diagram(page));
  expect(label, 'the label is drawn').toBeGreaterThan(0);
  expect(label, `the label (${label}px) fits its box (${box}px)`).toBeLessThan(box);
});

test('switching the theme recolors a diagram already on the page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openReader(page, `/wiki/${PATH}`);
  const svg = await diagram(page);
  expect(await labelInk(svg), 'light: the labels take the page ink').toBe(await pageInk(page));
  await page.getByTestId('wiki-theme-toggle').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true);
  await expect.poll(() => labelInk(svg), { message: 'the labels follow the switch' })
    .toBe(await pageInk(page));
});

test('a chart draws its series in the page accent', async ({ page }) => {
  await openReader(page, `/wiki/${CHART}`);
  const svg = await diagram(page);
  // Both colors through a 1px canvas: the token is hex, the computed fill rgb().
  const [bar, accent] = await svg.evaluate((root) => {
    const c = document.createElement('canvas'); c.width = 1; c.height = 1;
    const ctx = c.getContext('2d');
    const rgb = (color: string): string => {
      if (ctx === null) return color;
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',');
    };
    const tallest = [...root.querySelectorAll('rect')]
      .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    return [rgb(tallest === undefined ? '' : getComputedStyle(tallest).fill),
      rgb(getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())];
  });
  expect(bar, 'the bars are the page accent').toBe(accent);
});
