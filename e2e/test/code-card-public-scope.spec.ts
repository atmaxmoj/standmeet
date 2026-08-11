// code-card-public-scope.spec.ts —— 挂 public 的码，卡上不许说它"什么都读不到"（UX-67）。
//
// F-D-7 之后 `public` 身份**没有正列表**：它读的是 owner 发布过的那些，由每条笔记自己的
// 开关定。码卡片上「CORPUS · INHERITED FROM ROLE」那一格直接渲染那份列表，空了就打印
// `(role grants nothing)` —— 于是一张公开码被写成"什么都看不到"，而它明明读得到已发布的条目。
//
// 这句话是 owner 判断「这张码能看什么」的唯一依据，所以它说反了不是文案问题。
//
// RED（修之前）：public 那张卡上出现 `(role grants nothing)`。

import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { getRoleByName } from '@/fixtures/roles';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'codescope@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'codescope',
  fullName: 'Code Scope Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('codes · the card says what the code can actually read', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const publicRole = await getRoleByName(request, 'public');
    // 一张显式挂 public 的码（owner 决定"这个人只看公开面"）。
    await createCode(request, csrf, {
      code: 'PUBCARD-1', label: 'pubcard', assumed_role_id: publicRole.id,
    });
    // 一张留空的（= invited），当对照：它有真正的正列表。
    await createCode(request, csrf, { code: 'INVCARD-1', label: 'invcard' });
    await request.dispose();
  });

  test('a public-scoped code is not described as reading nothing', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'codes');
    const pub = adminPage.getByTestId('code-corpus-PUBCARD-1');
    await expect(pub).toBeVisible({ timeout: 10_000 });
    // 正向对照先跑：invited 那张确实列出 glob —— 否则下面那条"没说 nothing"可能只是这一格没渲染。
    await expectInheritedGlobs(adminPage);
    await expect(
      pub,
      'a code on the public role reads the published slice — the card must not call that nothing',
    ).not.toContainText('grants nothing');
    await expect(pub, 'and it says what the scope actually is').toContainText(/published/i);
  });
});

async function expectInheritedGlobs(page: Page): Promise<void> {
  const inv = page.getByTestId('code-corpus-INVCARD-1');
  await expect(inv, 'the invited code card renders its inherited list').toContainText('wiki://**');
}
