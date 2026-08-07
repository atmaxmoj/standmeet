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
      // 断到真数据渲染:tiers 串只有加载出真计数才出现("N raw · …"),占位是 "loading…"。
      // 避免 /\d/ 的 false-green —— 那被静态标题 "corpus pulse · 14d" 满足,证明不了真数。
      await expect(pulse).toContainText(/\d+\s*raw/);
    });

  // F-C-7 —— 这块面板上并排放着两个孤零零的时间窗口:标题写 `CORPUS PULSE · 14D`,右边用
  // accent 色写 `+0 · 7d`。两个 range 令牌挨在一起,一个"选中"一个"可选" —— 它读起来就是个
  // 范围切换器,我在冷扫时点了 `7d`,什么都没发生。它不是一个坏掉的控件,它压根不是控件:
  // 一个是火花线的窗口,另一个是增量的窗口,两件不相干的事被排版成了一对选项。
  //
  // 断言:每个数字自己说清楚量的是什么窗口,面板上不再有两个裸露的 range 令牌并排。
  test('the pulse rail does not read as a range toggle (F-C-7)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'system');
      const text = (await adminPage.getByTestId('system-pulse').innerText()).toLowerCase();
      expect(text, '增量必须自己说清楚它数的是哪一段时间').toMatch(/in 7d/);
      // 裸露 = 前面没有一个说明词。`+0 · 7d` 是裸的(读起来像个可选项),`+0 in 7d` 不是。
      const bare = [...text.matchAll(/(\S+)\s+(\d+d)\b/g)]
        .filter((m) => m[1] !== 'in' && m[1] !== 'last');
      expect(
        bare.map((m) => m[0]),
        '不许再有裸露的 range 令牌 —— 那正是让它看起来像开关的东西',
      ).toHaveLength(0);
    });
});
