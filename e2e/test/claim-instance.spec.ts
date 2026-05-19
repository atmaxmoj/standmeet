// claim-instance.spec.ts —— first-run claim 流程的真用户路径。
//
// 用户故事：
//   一个全新部署的 StandMeet 实例还没人 claim。owner 看到 backend 启动日志
//   里打印的 setup URL，打开它 → 在 wizard 里填名字 / handle → 下一步填
//   邮箱密码 → submit → 跳到自己的 owner 页 /<handle>。再次回到 /setup
//   不应该能 claim 第二次（一次性 token + is_claimed flag）。

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  full: 'Alice Anderson',
  handle: 'alice',
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe.serial('owner claims a fresh instance via /setup', () => {
  test('first-run flow lands the owner on their own page', async ({ page }) => {
    resetInstance();
    const token = findSetupToken();

    await goto(page, `/setup?t=${token}`);
    await fillIdentityStep(page);
    await fillCredentialsStep(page);
    await expectLandedOnOwnerPage(page);
  });
});

async function fillIdentityStep(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /Claim this/ })).toBeVisible();
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('next').click();
}

async function fillCredentialsStep(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
  await page.getByTestId('submit').click();
}

async function expectLandedOnOwnerPage(page: Page): Promise<void> {
  await page.waitForURL(`**/${OWNER.handle}`, { timeout: 10_000 });
  // 设计稿里 owner full_name 摆 identity strip span，不是 heading。
  await expect(page.getByText(OWNER.full)).toBeVisible();
}
