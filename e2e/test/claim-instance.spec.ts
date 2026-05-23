// claim-instance.spec.ts —— first-run claim 流程的真用户路径。
//
// 用户故事：
//   一个全新部署的 StandMeet 实例还没人 claim。owner 打开域名 / —— server
//   端发现 unclaimed → 自动 redirect 到 /setup?t=<token>，token 由 backend
//   把启动时生成的 plaintext 顺着 /api/v1/instance 回吐。owner 填名字 /
//   handle / public_url → 下一步填邮箱密码 → submit → 自动跳到自己的公开页 /。

import type { Page } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Alice Anderson',
  handle: 'alice',
  publicUrl: 'http://localhost:38127',
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe.serial('owner claims a fresh instance via /setup', () => {
  test.beforeAll(() => {
    resetInstance();
  });

  test('opening / on a fresh instance lands the owner in the claim wizard and admin',
    async ({ page }) => {
      // 入口 fixture goto('/') 之后：unclaimed → server redirect 到 /setup?t=...
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });

      await fillIdentityStep(page);
      await fillCredentialsStep(page);
      await expectLandedOnAdmin(page);
    });
});

async function fillIdentityStep(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /Claim this/ })).toBeVisible();
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('public-url').fill(OWNER.publicUrl);
  await page.getByTestId('next').click();
}

async function fillCredentialsStep(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
  await page.getByTestId('submit').click();
}

// SetupForm 提交成功后 router.push('/admin') —— owner 部署完直接进 admin
// 开始管理。/admin server 端 redirect 到 /admin/page；AdminShell 见到刚才
// claim 流程写的 session cookie 即 ready，渲染 sidebar (含 "page" 链接)。
async function expectLandedOnAdmin(page: Page): Promise<void> {
  await page.waitForURL('**/admin/page', { timeout: 10_000 });
  await expect(page.getByRole('link', { name: /\bpage\b/ })).toBeVisible();
}
