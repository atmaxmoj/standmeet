// dashboard-corpus-pulse.spec.ts —— the dashboard's "corpus pulse · 14d" sparkline must
// draw the **real** series, not something hardcoded.
//
// rot-A1: the curve used to be `MOCK_14D = [4,7,2,6,11,3,8,5,9,12,6,14,9,17]` — a fixed
// zigzag with nothing to do with the corpus, sitting right next to the real total and
// topped with a green "active" badge, reading like a genuine 14-day activity trend. The
// real per-day series was already in the same endpoint (`/stats/growth`'s `series`, one
// date_trunc GROUP BY), but the dashboard's schema dropped it. The owner uses this to
// judge "is my corpus actually growing" — and it was a chart that never moved.
//
// Criterion (robust, doesn't import app internals): in deriveSparklinePoints,
// `y = pad + (1 - v/max)*(h-2pad)` — the larger the value, the smaller the y. Feed it a
// **monotonically increasing** series; when the real data is drawn, the polyline's y
// coordinates must be **monotonically decreasing**; when MOCK_14D (a zigzag) is drawn,
// y goes up and down. So asserting y is non-increasing is enough — no need to compare
// exact coordinates.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'pulse-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'pulseowner',
  fullName: 'Pulse Owner',
};

// RAMP —— a monotonically increasing 14-day series. Real data drawn → y decreases
// monotonically; MOCK_14D → zigzag.
const RAMP = Array.from({ length: 14 }, (_, i) => ({ day: `2026-07-${String(i + 1).padStart(2, '0')}`, count: i + 1 }));

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('dashboard · the corpus-pulse sparkline draws the real series, not a constant', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('a monotonic-increasing /stats/growth series ⇒ a monotonic-decreasing sparkline', pulseFollowsSeries);
});

// pulseFollowsSeries —— pins /stats/growth to a monotonically increasing series and
// asserts the corpus-pulse line follows it.
async function pulseFollowsSeries({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await page.route(/\/api\/admin\/stats\/growth/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    // **The payload must satisfy the client's schema** (`CorpusGrowthSchema`: total /
    // delta_7d / by_tier / series). Missing total or delta_7d makes zod reject the
    // whole thing, and the card falls back to its empty state (`nothing new in 14d` /
    // `0 entries`), while this test only asserts "how many points got drawn" — so it
    // can go red/green for **an unrelated reason**. That's exactly how it went red
    // after the 2026-08-16 dev-volume swap ([[zod-unknown-is-not-optional]]: the
    // server's shape changed, the client schema failed whole, and it did so silently).
    body: JSON.stringify({
      total: RAMP.reduce((n, d) => n + d.count, 0),
      delta_7d: RAMP.slice(-7).reduce((n, d) => n + d.count, 0),
      by_tier: { raw: 14, wiki: 0, output: 0, writing: 0, raw_unprocessed: 0 },
      series: RAMP,
    }),
  }));
  // Reloading forces the dashboard to remount, so the growth fetch only fires once the
  // route interception is armed (the adminPage fixture lands already on the dashboard,
  // and that first fetch happens before the route is registered; without the reload the
  // interception never takes effect and it draws the real, empty series instead).
  await gotoAdminSection(page, 'dashboard');
  await page.reload();

  const pulse = page.getByRole('img', { name: 'corpus pulse · 14d' });
  await expect(pulse).toBeVisible({ timeout: 10_000 });
  const polyline = pulse.locator('polyline');
  // Poll: after the intercepted response comes back, React still has to re-render;
  // reading immediately would read the previous frame. Wait for the line to actually
  // finish drawing the whole series.
  await expect.poll(
    async () => (await pulseYs(polyline)).length,
    { message: 'the pulse must plot every day of the intercepted series', timeout: 10_000 },
  ).toBe(RAMP.length);
  const ys = await pulseYs(polyline);
  expect(
    isNonIncreasing(ys),
    `a rising series must render as a falling line (higher count → lower y); got y=[${ys.map((y) => y.toFixed(0)).join(',')}] — a zigzag means the fixed MOCK_14D is still being drawn`,
  ).toBe(true);

  // F-C-5 (rework): the pulse must be LEGIBLE, not just shaped — a REAL axis + a REAL hover
  // tooltip. v1 used native SVG <title> on 1.6px markers (≈1s delay, stretched hit target, no
  // visual) and the owner rejected it live twice ("no axis, no hover tooltip"). Now:
  //   axis — y reference labels (max / mid / 0) render beside the gridlines;
  //   tooltip — hovering ANYWHERE on the chart snaps to the nearest day and shows "<date> · <count>"
  //   in an HTML tip box (plus a crosshair + highlight ring in the SVG).
  // RED before the rework: no `sparkline-axis` node, and hovering produced no `sparkline-tooltip`.
  // scope to the corpus-pulse box specifically — the dashboard hosts >1 sparkline (pulse + ingest),
  // so a bare getByTestId('sparkline-box') would strict-mode-fail once both render.
  const box = page.getByTestId('sparkline-box').filter({ has: pulse });
  const axis = box.getByTestId('sparkline-axis');
  await expect(axis, 'a real y-axis: the max reference value is visible').toContainText(String(RAMP.length));
  await expect(axis, 'a real y-axis: the zero baseline is labeled').toContainText('0');
  // hover the right edge → snaps to the LAST day; the tip must carry date · count.
  const bb = await box.boundingBox();
  const last = RAMP[RAMP.length - 1]!;
  await page.mouse.move(bb!.x + bb!.width - 2, bb!.y + bb!.height / 2);
  const tip = box.getByTestId('sparkline-tooltip');
  await expect(tip, 'hovering shows a real tooltip with the day').toContainText(last.day);
  await expect(tip, 'the tooltip carries the concrete count').toContainText(String(last.count));
  await expect(box.getByTestId('sparkline-hover-mark'), 'the hovered point is highlighted').toBeVisible();
  // leaving clears it — a lingering tooltip is its own small lie.
  await page.mouse.move(bb!.x + bb!.width / 2, bb!.y - 40);
  await expect(tip).toBeHidden();
}

// pulseYs —— reads the polyline's points and extracts the y-coordinate sequence.
async function pulseYs(polyline: ReturnType<Page['locator']>): Promise<number[]> {
  const points = await polyline.getAttribute('points');
  return (points ?? '')
    .trim()
    .split(/\s+/)
    .map((pt) => Number(pt.split(',')[1] ?? ''))
    .filter((y) => Number.isFinite(y));
}

function isNonIncreasing(ys: readonly number[]): boolean {
  // pairwise on adjacent slots; noUncheckedIndexedAccess-safe (prev defaults to +∞ so i=0 passes).
  return ys.every((y, i) => y <= (ys[i - 1] ?? Infinity) + 0.01);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await request.dispose();
}
