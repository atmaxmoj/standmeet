// visitor-turn-count-from-backend.spec.ts —— turn 计数的唯一 source of truth
// 是后端 conversation,前端 localStorage 的 `used` 只是缓存。两者一旦 desync
// (例:后端会话被重置 / owner 删了对话,但浏览器 localStorage 还留着旧 used),
// 重新载入后必须以后端数出来的为准 —— 否则就出现「一上来没问就 1/50,却没有
// 任何 dialog」这种不一致。
//
// 期望:reload 后 strip 的 used == 后端这段对话里实际 visitor turn 数
//       == 可见的 dialog 数。stale localStorage 不算数。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'COUNT-001';
const NAME = 'Frank';
const QUESTION = 'tell me about lucerna';
const USED_SEL = '[data-testid="session-strip-gauge"] .sm-session-strip-used';

test.describe('turn 计数以后端 conversation 为唯一 source of truth', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'count-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('一进来没问 → used = 0(不是凭空 1)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);
    await expect(page.locator(USED_SEL)).toHaveText('0', { timeout: 10_000 });
    await ctx.close();
  });

  test('stale localStorage used → reload 后以后端数出来的为准', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);

    // 问一句 → 后端落 1 条 visitor turn,strip 走到 1。
    const dialogRecorded = page.waitForResponse((r) =>
      r.url().includes('/dialogs') && r.status() === 204, { timeout: 20_000 });
    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(QUESTION);
    await input.press('Enter');
    await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
    await dialogRecorded;
    await expect(page.locator(USED_SEL)).toHaveText('1', { timeout: 10_000 });

    // 人为把 localStorage 的 used 搞脏(模拟客户端缓存跟后端 desync)。
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('standmeet-session');
      if (raw === null) throw new Error('no standmeet-session in localStorage');
      const parsed = JSON.parse(raw) as { used: number };
      parsed.used = 9;
      window.localStorage.setItem('standmeet-session', JSON.stringify(parsed));
    });

    // reload → 后端 history 重建 transcript,used 必须被后端数出来的(1)纠回,
    // 而不是沿用 stale 的 9。计数 == 可见 dialog 数。
    await page.reload();
    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(USED_SEL)).toHaveText('1', { timeout: 10_000 });

    await ctx.close();
  });

  test('别的访客占了名额 → reload 后 member_count 按后端纠回', async ({ browser }) => {
    const namesUsed = '[data-testid="session-strip-names"] .sm-session-strip-members-used';

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await enterCodeSession(page1, CODE, NAME);
    await expect(page1.locator(namesUsed)).toHaveText('1', { timeout: 10_000 });

    // 第二个访客用别的名字进同一张 code → 后端 member_count 变 2。page1 浑然不知。
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await enterCodeSession(page2, CODE, 'Grace');

    // page1 reload → snapshot 把 member_count 从 stale 的 1 纠到后端的 2。
    await page1.reload();
    await expect(page1.locator(namesUsed)).toHaveText('2', { timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });
});
