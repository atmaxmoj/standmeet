// admin-system-pulse.spec.ts —— Monitor/observability。SystemPulse(sidebar 语料库脉搏)接真
// GET /api/admin/stats/growth:corpus 14d 增长序列 + 7d delta + 分层计数。RED 直到端点落地
// (现在 404)。绿=脉搏显真数,不再 "growth metrics not yet wired"。诚实:无数据也返 0 序列。

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
  // 两条 corpus(每条 seedWiki 落 raw + wiki）→ 至少 2 raw + 2 wiki 今天新增。
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

    // 分层计数是真的(seed 了 ≥2 raw + ≥2 wiki)。
    expect(g.by_tier.raw, 'raw count reflects seeded raws').toBeGreaterThanOrEqual(2);
    expect(g.by_tier.wiki, 'wiki count reflects seeded wikis').toBeGreaterThanOrEqual(2);
    expect(g.total, 'total = sum of tiers').toBe(
      g.by_tier.raw + g.by_tier.wiki + g.by_tier.output,
    );
    // 14 天序列,今天(末位)有新增,7d delta 覆盖刚 seed 的。
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
      await expect(pulse).toContainText(/\d/); // a real count/sparkline digit
    });
});
