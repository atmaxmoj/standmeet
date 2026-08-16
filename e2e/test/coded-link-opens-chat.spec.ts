// coded-link-opens-chat.spec.ts —— 产品**自己发出去的那个链接**，走浏览器的前门能不能进（F-M-1）。
//
// 真实环境驱出来的：owner 在 `/admin/requests` 批准一条申请 → 信真的到了真收件箱 →
// 里面的链接是 `http://…?code=inv-ilbro6` → **点开是 gate 的空码框**。同一个码手打进 gate
// 却正常开会话。差别只有大小写。
//
// 两条路对同一个概念有两套规矩：
//   · `code-panel-logic.ts:10` 手打那条 —— `raw.toUpperCase()`，所以 gate 上写的
//     "case doesn't matter" 是真的；
//   · `use-absorb-code.ts:33` 的 `?code=` 那条 —— **原样吸收，不归一**。
// 而铸码那一侧两类码都是小写：`access_approval.go:169`（`inv-xxxxxx`，批准发信用）、
// `jobsuc/applications.go:193`（`app-xxxxxx`，简历 PDF 右上角那个 QR 用）。
// **产品铸小写、拼链接原样带小写、前门只认大写。**
//
// 为什么现有守卫全绿：`code-intro-greeting.spec.ts:52` 驱 `?code=` 但夹具是规范大写；
// `applications-commit-qr-works.spec.ts` 的注释说它证明「QR 能打开 chat」，实际是直接
// POST `/api/v1/sessions` —— 后端接受小写，那道**浏览器前门**从没被驱过
// （[[test-covers-capability-not-face]]）。
//
// 所以这里钉的是**脸**：一个访客拿着产品发的链接，在浏览器里打开它。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'codedlink@example.com', password: 'correct-horse-battery-staple',
  handle: 'codedlink', fullName: 'Coded Link Owner',
};

// 小写 —— **产品自己铸出来的形状**（inv- / app- 两类都是）。不是我发明的边角输入。
const MINTED_LOWERCASE = 'inv-ab3d9f';

test.describe('产品发出去的那个链接，前门认不认', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'codedlink-invited', description: 'scoped', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, {
      code: MINTED_LOWERCASE, label: 'invite', assumed_role_id: role.id,
    });
    await request.dispose();
  });

  test('带着小写码的链接（批准信 / 简历 QR 的形状）直接开身份选择器，不掉回 gate',
    async ({ page }) => {
      await goto(page, `/?code=${MINTED_LOWERCASE}`);
      // 身份选择器 = 这条路走通了。掉回 gate 的话这个 testid 根本不存在。
      await expect(
        page.getByTestId('visitor-name-overlay'),
        '拿着产品自己发的链接进来的人，不该再被要求输入一个他手上就有的码',
      ).toBeVisible({ timeout: 8_000 });
    });

  test('大写的同一张码照旧工作（修法不许把原来能用的那半弄坏）',
    async ({ page }) => {
      await goto(page, `/?code=${MINTED_LOWERCASE.toUpperCase()}`);
      await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 8_000 });
    });
});
