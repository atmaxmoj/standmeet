// owner-email-normalized-at-every-entrance.spec.ts —— 邮箱规范化不能只在一个使用点做。
//
// 缺陷（审计 2026-08-30）：`usecase.normalizeEmail`（trim + 转小写）**只有 change_email
// 调它**。`claim` / `login` / `recover` 三个入口都把原值直接透传下去。
//
// 大小写侥幸不出事 —— `owners.email` 是 `citext`。**空格会出事**：citext 不 trim。
// claim 的时候带一个前导空格进去，那个带空格的字符串就成了身份，之后正常输入永远登不上，
// 而且 recover 也救不了（同一个查找路径）。owner 在第一步就把自己锁在门外，还没有任何提示。
//
// 这是 CLAUDE.md A4 的教科书样本：外来数据在入口规范化一次，下游当字段总在。
// 现在的形状是"在其中一个使用点规范化了一次"，其余三处各自裸奔。
//
// 判据：**用干净的形式登得上**才算规范化生效。只断 /me 显示成小写不够 —— 显示层
// 大可以自己 toLowerCase，而登录走的是另一条路（「绿跑在哪条路上」）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  clearMailpit, configureMailConnector, confirmLinkIn, followMailedLink,
  recoveryPhraseIn, waitForMailTo,
} from '@/fixtures/mail';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// 进门时的脏形式：前后空格 + 混合大小写。三样毛病一次带齐。
const DIRTY = '  Nadia@Example.COM  ';
const CLEAN = 'nadia@example.com';
const PASSWORD = 'correct-horse-battery-staple';

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email, password },
  });
  return res.status();
}

test.describe('owner email · normalized at the entrance, not at one use site', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    // claim —— 这是邮箱第一次进入系统的入口，也是今天唯一没做规范化的那个。
    await claim(request, findSetupToken(), {
      email: DIRTY, password: PASSWORD, handle: 'nadia', fullName: 'Nadia Normal',
    });
    await request.dispose();
  });

  test('claimed with whitespace and mixed case → the clean form is the identity',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // ① 干净形式必须能登 —— 这才是 owner 下次会输入的东西。
      expect(await loginStatus(request, CLEAN, PASSWORD)).toBe(200);

      // ② 存下来的就是干净形式（不是靠展示层临时 toLowerCase 掩盖）。
      const { csrf } = await login(request, CLEAN, PASSWORD);
      const me = await request.get(`${BACKEND}/api/admin/me`, {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(me.status()).toBe(200);
      expect((await me.json() as { owner: { email: string } }).owner.email).toBe(CLEAN);

      // ③ 脏形式也能登 —— login 侧同样规范化了，否则 owner 复制粘贴带个空格就进不来。
      expect(await loginStatus(request, DIRTY, PASSWORD)).toBe(200);

      await request.dispose();
    });

  // `recover` 是第三个按 email 查人的入口（`usecase/recovery.go:105`）。
  //
  // 我第一版把它写成"脏形式和干净形式的回执状态码一致"—— 那条断言**永远绿**：
  // 短语错和查无此人故意回同一个码（防枚举），两边都是错误，比不出差别。
  // 换成走**成功路径**：拿一条真的 recovery phrase，用干净形式去 recover。
  // 成功只有一种，冒充不了（[[assertion-that-cannot-fail]]）。
  test('recovery finds the same owner through the clean form of a dirty-claimed email',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, CLEAN, PASSWORD);
      await clearMailpit(request);
      // 在 configureMailConnector **之后**再取 csrf：它内部自己登了一次,
      // 那一下换掉了 session,先取的 token 当场作废(403)。
      const { csrf } = await login(request, CLEAN, PASSWORD);

      const gen = await request.post(`${BACKEND}/api/admin/account/recovery`, {
        headers: { 'X-Csrftoken': csrf }, data: {},
      });
      expect(gen.status()).toBe(200);
      const phrase = recoveryPhraseIn(await waitForMailTo(request, CLEAN));

      // owner 被锁在外面，输入的是他记得的那个干净地址 —— 而库里存的是 claim 时的脏串。
      const fresh = await playwright.request.newContext();
      const rec = await fresh.post(`${BACKEND}/api/admin/recover`, {
        data: { email: CLEAN, recovery_phrase: phrase },
      });
      expect(rec.status(), 'recover 认不出干净形式 = 锁在外面救不回来').toBe(200);
      await fresh.dispose();
      await request.dispose();
    });

  // change_email 也走同一个咽喉 —— 包括**待确认**那一档。
  //
  // 这条上一版直接断"改完就能用干净形式登录"，而它依赖了一件没写出来的事：
  // 这台实例没有 mail connector。前一条用例配了一个，于是改动走进待确认那条路、
  // 身份根本没动，断言当场红 —— 红得对，但红的原因跟规范化毫无关系。
  // 现在把整条路走完：脏形式进去 → 点确认链接 → 干净形式成为身份。
  test('the normalization lives at the one chokepoint, including the pending path',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, CLEAN, PASSWORD);
      await clearMailpit(request);
      const { csrf } = await login(request, CLEAN, PASSWORD);

      const moved = '  Nadia+Moved@Example.COM  ';
      const clean = 'nadia+moved@example.com';
      const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
        headers: { 'X-Csrftoken': csrf },
        data: { current_password: PASSWORD, new_email: moved },
      });
      expect(res.status()).toBe(200);

      // 待确认那一列存的就得是干净形式 —— 它将来要成为 email 那一列，
      // 两边必须用同一把尺子（SetPendingEmail 也过 repo.NormalizeEmail）。
      // 确认信寄到的也是干净形式，所以直接按干净形式收信。
      const link = confirmLinkIn(await waitForMailTo(request, clean), 'confirm-email');
      await followMailedLink(page, link);
      // 等确认真的完成再断 —— 那一下 POST 是 hydration 之后在 useEffect 里发的，
      // `page.goto` 返回时它还没走。不等就是在断一个还没发生的事实。
      await expect(page.getByTestId('email-confirmed')).toBeVisible({ timeout: 15_000 });

      expect(await loginStatus(request, clean, PASSWORD)).toBe(200);
      // 脏形式也照样登得上 —— 查找那一侧用的是同一套规则。
      expect(await loginStatus(request, moved, PASSWORD)).toBe(200);
      await request.dispose();
    });
});
