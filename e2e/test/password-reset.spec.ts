// password-reset.spec.ts —— 紧急 password reset 兜底端到端。
//
// 用户故事：
//   owner 忘了密码。在服务器上 ssh 进去 docker exec 跑 `standmeet
//   password-reset` 子命令，stdout 打出一条 /account/reset?t=... 链接。
//   owner 拷链接进浏览器，填新密码两次 → submit → 跳 /login → 用新密码
//   登入成功。token 被消费，第二次同 URL 失败。
//
// e2e 实现：不走真 Makefile（make password-reset 调 docker compose exec，
// e2e fixture 通用是 docker exec 直接对容器）；写一个 fixture helper 调
// `docker exec standmeet-dev-backend-1 /standmeet password-reset` 拿 stdout
// 里的 URL。

import { execSync } from 'node:child_process';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const NEW_PASSWORD = 'brand-new-correct-horse-12345';

test.describe.serial('owner uses CLI-issued reset link to set a new password', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('CLI prints /account/reset?t=...; form sets new password; old one stops working',
    async ({ page, playwright }) => {
      const url = issueResetToken();
      await openResetAndSubmit(page, url, NEW_PASSWORD);

      // 新密码登 OK；旧密码 401。
      const request = await playwright.request.newContext();
      const fresh = await loginAPI(request, OWNER.email, NEW_PASSWORD);
      expect(fresh.csrf).toBeTruthy();
      await expectLoginRejected(request, OWNER.email, OWNER.password);
      await request.dispose();
    });

  test('reset URL is single-use; second submission with same token fails',
    async ({ page }) => {
      const url = issueResetToken();
      // 第一次成功（先把密码换一遍）
      await openResetAndSubmit(page, url, NEW_PASSWORD + '-1');
      // 第二次同 URL 应 401，留在表单上
      await goto(page, urlPath(url));
      await page.getByTestId('reset-new-password').fill(NEW_PASSWORD + '-2');
      await page.getByTestId('reset-confirm-password').fill(NEW_PASSWORD + '-2');
      await page.getByTestId('reset-submit').click();
      await expect(page.getByTestId('reset-error')).toBeVisible();
      await expect(page.getByTestId('reset-error')).toContainText(/invalid|expired/i);
    });
});

// issueResetToken —— docker exec 跑 standmeet password-reset；从 stdout
// 抓 reset URL。子命令完成会 exit；execSync 拿全输出。
function issueResetToken(): string {
  const out = execSync(
    'docker compose -f ../docker-compose.dev.yml -p standmeet-dev '
    + 'exec -T backend /app/standmeet password-reset',
    { encoding: 'utf-8' },
  );
  const match = out.match(/(https?:\/\/[^\s]+\/account\/reset\?t=[^\s]+)/);
  if (!match) {
    throw new Error('did not find reset URL in CLI output:\n' + out);
  }
  return match[1];
}

function urlPath(absURL: string): string {
  const u = new URL(absURL);
  return u.pathname + u.search;
}

async function openResetAndSubmit(page: Page, url: string, newPwd: string): Promise<void> {
  await goto(page, urlPath(url));
  await expect(page.getByRole('heading', { name: /Set a new/i })).toBeVisible();
  await page.getByTestId('reset-new-password').fill(newPwd);
  await page.getByTestId('reset-confirm-password').fill(newPwd);
  await page.getByTestId('reset-submit').click();
  await page.waitForURL('**/login', { timeout: 10_000 });
}

async function expectLoginRejected(
  request: APIRequestContext, email: string, password: string,
): Promise<void> {
  const res = await request.post(
    (process.env['BACKEND_URL'] ?? 'http://localhost:8000') + '/api/admin/login',
    { data: { email, password } },
  );
  expect(res.status()).toBe(401);
}
