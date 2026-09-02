// admin-system-pulse.spec.ts -- Monitor/observability. SystemPulse (the sidebar corpus
// pulse) wires to the real GET /api/admin/stats/growth: 14d corpus growth series + 7d
// delta + per-tier counts. RED until the endpoint lands (currently 404). Green = the
// pulse shows real numbers, not "growth metrics not yet wired". Honest: no data still
// returns a zero series.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'alice@example.com', password: 'test-password-1234',
  handle: 'alice', fullName: 'Alice',
};

interface Growth {
  total: number;
  delta_7d: number;
  by_tier: { raw: number; wiki: number; output: number };
  series: { day: string; count: number }[];
}

async function initOwnerWithCorpus(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pulse-seed');
  const sid = await initMCP(request, token);
  // Two corpus entries (each seedWiki writes both raw + wiki) → at least 2 raw + 2 wiki
  // added today.
  await seedWiki(request, token, sid, { title: 'Pulse Doc One', body: 'growth pulse content one' });
  await seedWiki(request, token, sid, { title: 'Pulse Doc Two', body: 'growth pulse content two' });
  await request.dispose();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · SystemPulse corpus-growth stats', () => {
  test.beforeAll(async ({ playwright }) => { await initOwnerWithCorpus(playwright); });

  test('GET /api/admin/stats/growth returns real 14d corpus growth', async ({ adminPage }) => {
    const res = await adminPage.request.get(`${BACKEND}/api/admin/stats/growth`);
    expect(res.status(), 'growth endpoint 200').toBe(200);
    const g = await res.json() as Growth;

    // The per-tier counts are real (seeded >=2 raw + >=2 wiki).
    expect(g.by_tier.raw, 'raw count reflects seeded raws').toBeGreaterThanOrEqual(2);
    expect(g.by_tier.wiki, 'wiki count reflects seeded wikis').toBeGreaterThanOrEqual(2);
    expect(g.total, 'total = sum of tiers').toBe(
      g.by_tier.raw + g.by_tier.wiki + g.by_tier.output,
    );
    // A 14-day series, today (the last entry) has additions, and the 7d delta covers what
    // was just seeded.
    expect(g.series.length, '14-day series').toBe(14);
    expect(g.series[13]?.count, 'today has the seeded entries').toBeGreaterThanOrEqual(4);
    expect(g.delta_7d, '7d delta includes just-seeded entries').toBeGreaterThanOrEqual(4);
  });

  test('SystemPulse sidebar shows real numbers, not the coming-soon placeholder',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const pulse = adminPage.getByTestId('system-pulse');
      await expect(pulse).toBeVisible();
      await expect(pulse).not.toContainText(/not yet wired|coming/i);
      // Asserts real data actually rendered: the tiers string only appears once real
      // counts have loaded ("N raw · ..."), the placeholder is "loading...".
      // Avoids a false-green on /\d/ -- that regex would already be satisfied by the
      // static heading "corpus pulse · 14d" and wouldn't prove real numbers.
      await expect(pulse).toContainText(/\d+\s*raw/);
    });

  // F-C-7 -- this panel places two unrelated time windows side by side: the heading reads
  // `CORPUS PULSE · 14D`, and to the right, in accent color, `+0 · 7d`. Two range tokens
  // sitting next to each other, one "selected" one "selectable" -- it reads exactly like a
  // range toggle, and during a cold sweep I clicked `7d` and nothing happened. It isn't a
  // broken control, it isn't a control at all: one is the sparkline's window, the other is
  // the delta's window, and two unrelated facts got laid out to look like a pair of options.
  //
  // Assertion: each number states its own window clearly, and the panel no longer has two
  // bare range tokens side by side.
  // F-C-11 -- this panel's body content **has never actually been seen**. The DOM has the
  // sparkline, the total, and the per-tier counts (so the two innerText assertions above
  // are both green), but the `aside` inside the `flex flex-col` sidebar is missing
  // `shrink-0`, so once the nav has enough items it gets squeezed down to just its heading
  // row -- 30px tall, everything else clipped off. On the real environment the owner has
  // only ever seen the single line `CORPUS PULSE  +0 in 7d`, with the 407 / `184 raw · 223
  // wiki` sitting just a few pixels below, out of view. Found by eye during a manual
  // regression pass: a text-reading assertion can't tell "rendered" apart from "squashed".
  //
  // The criterion is geometric: the per-tier-count row must fall **inside** the panel's
  // own box.
  test('the pulse rail is tall enough to show what it renders (F-C-11)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const rail = adminPage.getByTestId('system-pulse');
      const tiers = adminPage.getByTestId('pulse-tiers');
      await expect(tiers).toBeVisible();
      const railBox = await rail.boundingBox();
      const tiersBox = await tiers.boundingBox();
      expect(railBox, 'rail must have a box').not.toBeNull();
      expect(tiersBox, 'tiers must have a box').not.toBeNull();
      expect(
        tiersBox!.y + tiersBox!.height,
        '分层计数必须落在面板框里 —— 超出去就是被压扁了,owner 看不到',
      ).toBeLessThanOrEqual(railBox!.y + railBox!.height + 1);
    });

  test('the pulse rail does not read as a range toggle (F-C-7)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const text = (await adminPage.getByTestId('system-pulse').innerText()).toLowerCase();
      expect(text, '增量必须自己说清楚它数的是哪一段时间').toMatch(/in 7d/);
      // Bare = no qualifying word in front of it. `+0 · 7d` is bare (reads like a
      // selectable option), `+0 in 7d` is not.
      const bare = [...text.matchAll(/(\S+)\s+(\d+d)\b/g)]
        .filter((m) => m[1] !== 'in' && m[1] !== 'last');
      expect(
        bare.map((m) => m[0]),
        '不许再有裸露的 range 令牌 —— 那正是让它看起来像开关的东西',
      ).toHaveLength(0);
    });
});
