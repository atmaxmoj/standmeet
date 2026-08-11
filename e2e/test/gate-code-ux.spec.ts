// gate-code-ux.spec.ts —— gate code panel UX: uppercase normalization,
// error shake, checking state, code + name submit.
//
// 用户故事：
//   1. paste code → 大写归一 + 非 [A-Z0-9-] 过滤
//   2. 错误 code → shake 动画 → 清空 → refocus
//   3. "checking" 状态 → submit 后按钮文案变
//   4. code + name 一起提交 → session 带 visitor name
//
// 这里的每条错误用例断言的都是**那句话**，不是"有报错"：只断言 gate-error 可见的话，面板
// 把每一种非 2xx 都说成 "unknown code" 也照样绿（F-A-23）。而「不存在」和「被撤销」是
// F-D-6 拆开的两句 —— 打错字的人重新粘一次，被撤销的人去要新码（chat.go:122-134）。
// 那一刀没把措辞跟进这里，于是第一条**一直红着**；第二条（被撤销）从来没有过 e2e。
//
// UX-68：顶栏那一格显示的是**这张码自己的标签**（设计源 docs/design/project/app.js:696，
// 'OpenAI eng loop' / 'a16z partner intro'），`invited` 只是没有标签时的兜底。后端一直在
// 发 code_label，但 SDK 的 PublicSessionResponse 没声明它、gate 又写死 label: null，
// 于是每一张码都被说成 invited —— 那句欢迎语是在对访客陈述他自己的访问范围。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'gate-ux@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'gateux',
  fullName: 'Gate UX Owner',
};

const CODE = 'GATEUX-001';
// 一张真码,名额只有 1 个,而且已经被用掉了 —— 存在、没过期、就是满了。
const FULL_CODE = 'GATEUX-FULL';
// 一张发出去过、又被 owner 撤销的码 —— 它存在过,这跟"不存在"是两回事。
const REVOKED_CODE = 'GATEUX-REVOKED';

test.describe('gate code panel UX polish', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s，而钩子默认只给 30s
    await initOwner(playwright);
  });

  test('code input normalizes to uppercase',
    async ({ page }) => {
      await openGate(page);
      const codeInput = page.getByTestId('gate-code');
      await codeInput.fill('gateux-001');
      // Value should be uppercased
      await expect(codeInput).toHaveValue('GATEUX-001');
    });

  test('wrong code → the panel says the code is invalid',
    async ({ page }) => {
      await submitCode(page, 'BOGUS-CODE');
      await expect(page.getByTestId('code-panel').getByTestId('gate-error'))
        .toHaveText(/no such access code/i, { timeout: 5_000 });
    });

  test('a REVOKED code says it was revoked, not that it never existed',
    async ({ page }) => {
      await submitCode(page, REVOKED_CODE);
      const said = await gateErrorText(page);
      expect(said, '这张码存在过,不许说它从来没有过').not.toContain('no such access code');
      expect(said, '说出下一步:去要一张新的').toMatch(/revoked/);
    });

  // F-A-23 —— 一张真码,只是名额满了,被说成 "UNKNOWN CODE"。
  // 后端答得很准:401 = 这码不存在;403 `member_quota_reached` = 「this code is full - no more
  // names available」,那句话就是写给访客看的。而面板把所有非 2xx 压成一个布尔 error,
  // 于是拿着有效邀请的招聘官被告知他的码不存在 —— 他会重打一遍、认定 owner 给错了码、然后走人。
  test('a code that is FULL says so, instead of claiming it does not exist (F-A-23)',
    async ({ page }) => {
      await submitCode(page, FULL_CODE, 'Second Name');
      const said = await gateErrorText(page);
      expect(said, '这张码是真的存在的,不许说它不存在').not.toMatch(/unknown code/);
      expect(said, '把后端那句写给访客的话原样说出来').toMatch(/full|no more names/);
    });

  test('submit → checking state → button text changes',
    async ({ page }) => {
      await submitCode(page, CODE);
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
    });

  test('the strip and the welcome name THIS code’s slice, not the fallback (UX-68)',
    async ({ page }) => {
      await submitCode(page, CODE);
      await page.waitForURL('**/', { timeout: 10_000 });
      const strip = page.getByTestId('session-strip');
      await expect(strip).toBeVisible({ timeout: 5_000 });
      // 取文本再判：`.not.toContainText` 在元素还没渲染时也算通过。
      // 这一格 CSS 是 text-transform:uppercase，innerText 拿回来的是大写 —— 断言比的是
      // 「说的是哪张码」，不是字形，所以两边一起降到小写再比。
      const said = (await strip.innerText()).toLowerCase();
      expect(said, '顶栏说出这张码的标签').toContain('gate ux test');
      expect(said, '拿到了真标签就不该再退回兜底').not.toContain('invited');
    });

  test('code + visitor name → session carries name',
    async ({ page }) => {
      await openGate(page);
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Bob Smith');
      await page.getByTestId('gate-code-submit').click();
      await page.waitForURL('**/', { timeout: 10_000 });
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('session-strip')).toContainText('Bob Smith');
    });
});

// openGate —— 每条用例的开场都一样：从首页那条 "request access" 走到 /gate。
async function openGate(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'request access ↗' }).click();
  await page.waitForURL('**/gate', { timeout: 10_000 });
}

// submitCode —— 进 gate、填码（可带名字）、提交。用例只留下它自己要断的那句话。
async function submitCode(page: Page, code: string, visitor?: string): Promise<void> {
  await openGate(page);
  await page.getByTestId('gate-code').fill(code);
  if (visitor !== undefined) await page.getByTestId('gate-visitor-name').fill(visitor);
  await page.getByTestId('gate-code-submit').click();
}

// gateErrorText —— 等那句拒绝出现，取文本降小写。取文本再判是有意的：
// `.not.toContainText` 在元素还没渲染时也算通过。
async function gateErrorText(page: Page): Promise<string> {
  const err = page.getByTestId('code-panel').getByTestId('gate-error');
  await expect(err).toBeVisible({ timeout: 5_000 });
  return (await err.innerText()).toLowerCase();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'gate-ux-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'gate ux intro.', title: 'Gate UX Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Gate UX test',
  });
  await createCode(request, csrf, {
    code: FULL_CODE, label: 'Gate UX full', max_members: 1,
  });
  const revoked = await createCode(request, csrf, {
    code: REVOKED_CODE, label: 'Gate UX revoked',
  });
  await revokeCode(request, csrf, revoked.id);
  // 用掉那唯一一个名额:这张码从此存在、有效、且满员。
  await issueSession(request, {
    handle: OWNER.handle, code: FULL_CODE, visitor_name: 'First Name',
  });
  await request.dispose();
}
