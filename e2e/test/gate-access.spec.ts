// gate-access.spec.ts —— 访客没拿到 code，但通过 /<handle>/gate 输码进来。
//
// 用户故事：
//   HR 收到 owner 邮件里的 access code，没直接知道公开页 URL。她访问
//   /alice/gate，输入 INTRO-001，跳到 /alice，能聊 work-tagged 切片。

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from "@playwright/test";

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

test.describe.serial('visitor uses a gate code to enter a private page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedAndIssueCode(request);
    await request.dispose();
  });

  test('typing code on /<handle>/gate lands visitor on /<handle>',
    async ({ page }) => {
      await goto(page, `/${OWNER.handle}/gate`);
      await expect(page.getByTestId('code-panel')).toBeVisible();
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Sarah (HR)');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL(`**/${OWNER.handle}`, { timeout: 10_000 });
      // owner full name 在 identity strip span 里，不是 heading。
      await expect(page.getByText(OWNER.fullName)).toBeVisible();
    });
});

async function seedAndIssueCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'seed-token');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'I built FlexMesh for Canadian delivery drivers.',
    title: 'Work — FlexMesh',
    tags: ['work'],
  });
  await createCode(request, csrf, {
    code: CODE,
    label: 'Intro for HR',
    purpose: 'gate spec',
    included_tags: ['work'],
  });
}
