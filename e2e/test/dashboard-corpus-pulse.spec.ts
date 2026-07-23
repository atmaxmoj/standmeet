// dashboard-corpus-pulse.spec.ts —— 仪表盘的"corpus pulse · 14d"折线必须画**真** series，不是硬编码。
//
// rot-A1：曲线曾经是 `MOCK_14D = [4,7,2,6,11,3,8,5,9,12,6,14,9,17]` —— 一条跟 corpus 毫无关系的固定
// 锯齿，却摆在真 total 旁边、顶着绿色 "active" 徽标，读起来像真的 14 天活跃趋势。而真的 per-day
// series 早就在同一个 endpoint 里（`/stats/growth` 的 `series`，一条 date_trunc GROUP BY），仪表盘
// 的 schema 把它丢了。owner 拿它判断"我的 corpus 有没有在长"——一张永远不动的图。
//
// 判据（稳健、不 import app 内部）：deriveSparklinePoints 里 `y = pad + (1 - v/max)*(h-2pad)` ——
// 值越大 y 越小。喂一条**单调递增**的 series，真数据被画时 polyline 的 y 坐标必然**单调递减**；
// 画 MOCK_14D（锯齿）时 y 上上下下。所以断言 y 单调不增即可，无需比对精确坐标。

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

// RAMP —— 一条单调递增的 14 天 series。真数据被画 → y 单调递减；MOCK_14D → 锯齿。
const RAMP = Array.from({ length: 14 }, (_, i) => ({ day: `2026-07-${String(i + 1).padStart(2, '0')}`, count: i + 1 }));

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('dashboard · the corpus-pulse sparkline draws the real series, not a constant', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('a monotonic-increasing /stats/growth series ⇒ a monotonic-decreasing sparkline', pulseFollowsSeries);
});

// pulseFollowsSeries —— 把 /stats/growth 钉成一条单调递增 series，断言 corpus-pulse 折线跟着它走。
async function pulseFollowsSeries({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await page.route(/\/api\/admin\/stats\/growth/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      by_tier: { raw: 14, wiki: 0, output: 0, raw_unprocessed: 0 },
      series: RAMP,
    }),
  }));
  // reload 强制 dashboard 重新挂载 → growth fetch 在 route 已武装时才打（adminPage fixture 落地
  // 就在 dashboard，那一发 fetch 早于 route 注册；不 reload 的话拦截根本没生效，画的是真实空 series）。
  await gotoAdminSection(page, 'dashboard');
  await page.reload();

  const pulse = page.getByRole('img', { name: 'corpus pulse · 14d' });
  await expect(pulse).toBeVisible({ timeout: 10_000 });
  const polyline = pulse.locator('polyline');
  // poll：拦截响应回来后 React 还要重渲染，直接读会读到上一帧。等折线真的画满整条 series。
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
  // visual) and the owner rejected it live twice ("没有轴，没有hover tooltip"). Now:
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

// pulseYs —— 读 polyline 的 points，抽出 y 坐标序列。
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
