// session-strip-switch-name.spec.ts —— session strip 上的名字可点 = 换人。
//
// 故事:Alice 具名进来、问一句、留下 transcript。点 strip 上的 "you · Alice"
// → 名字选择器重开 → 填 Bob 提交 → 变成新 member(member 数 +1)+ 新对话(旧
// transcript 清掉)。同名再点则续上(不新增 member)—— 由 member 数不变佐证。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

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

const CODE = 'SWITCH-5';

test.describe('session strip 点名字换人', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedSwitchCode(request);
    await request.dispose();
  });

  test('点 "you · Alice" → 填 Bob → 新 member(2/5)+ 新对话(旧 transcript 清掉)',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE, 'Alice');
      const switchBtn = page.getByTestId('session-strip-switch-name');
      await expect(switchBtn).toHaveText('you · Alice', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip-names')).toContainText('1 / 5');

      // Alice 问一句,留下一段 transcript。
      await ask(page, 'tell me about lucerna');
      await expect(page.locator('[data-testid="answer-body"]')).toHaveCount(1, {
        timeout: 20_000,
      });

      // 换人:点名字 → picker 重开 → 填 Bob 提交。
      await switchBtn.click();
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Bob');
      await page.getByTestId('visitor-name-submit').click();

      // 新身份:strip 显 Bob;新 member → 2/5;旧对话清掉(answer-body 归零)。
      await expect(switchBtn).toHaveText('you · Bob', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip-names')).toContainText('2 / 5');
      await expect(page.locator('[data-testid="answer-body"]')).toHaveCount(0);

      await ctx.close();
    });

  test('换回同名 Alice → 续上,不新增 member(仍 2/5)',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE, 'Carol'); // 第 3 个名字 → 3/5
      const switchBtn = page.getByTestId('session-strip-switch-name');
      await expect(switchBtn).toHaveText('you · Carol', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip-names')).toContainText('3 / 5');

      // 换成已存在的 Alice → 续会,member 数不增(仍 3/5)。
      await switchBtn.click();
      const nameInput = page.getByTestId('visitor-name-input');
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.fill('Alice');
      await page.getByTestId('visitor-name-submit').click();

      await expect(switchBtn).toHaveText('you · Alice', { timeout: 5_000 });
      await expect(page.getByTestId('session-strip-names')).toContainText('3 / 5');

      await ctx.close();
    });
});

async function ask(page: Page, q: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(q);
  await input.press('Enter');
}

async function seedSwitchCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'switch-name-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'switch-name spec', max_members: 5,
  });
}
