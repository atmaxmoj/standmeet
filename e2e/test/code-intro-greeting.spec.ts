// code-intro-greeting.spec.ts —— 名字选择器在 issue 前拉 code intro:
// owner per-role greeting「这是什么」+ "Up to N people — M already in" 名额行。
//
// 业务故事:
//   1. owner 建一个带 greeting 的 role,发一张 max_members=2 的码引用它。
//   2. visitor 扫码 → 名字选择器显 owner 写的 greeting + "Up to 2 people … 0 already in"。
//   3. 第一个具名 visitor 进来后,新 context 再扫 → "1 already in"(member_count 实时)。
//
// 边界(都是我写的分支,逐条钉死):
//   · role 没设 greeting → 后端回落 "This is <handle>'s AI…" 默认介绍。
//   · max_members=1 → 单数 "Up to 1 person"(非 "people")。
//   · max_members 不设(无限)→ 名额行空 → picker 回落 "More than one person…"。
//   · code 无效 → intro 拉失败 → 无 greeting + 回落名额行,picker 不崩。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'intro-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'introowner',
  fullName: 'Intro Owner',
};

const CODE = 'INTRO-001'; // Greeter role, max_members=2
const DEFAULT_CODE = 'INTRO-DEFAULT'; // Plain role (no greeting), max_members=3
const SOLO_CODE = 'INTRO-SOLO'; // Greeter role, max_members=1
const OPEN_CODE = 'INTRO-OPEN'; // Greeter role, max_members 不设 = 无限
const BAD_CODE = 'NOPE-404'; // 从未创建

const GREETING =
  "This is Intro Owner's AI — ask it anything, it answers in their voice.";
// 后端 defaultGreeting(handle) 的精确文案(role 没 greeting 时)。
const DEFAULT_GREETING =
  "This is introowner's AI. Ask it anything — it answers in " +
  "introowner's voice, grounded in their real work.";

test.describe('code intro · greeting + member-count on name picker', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwnerWithGreetingCode(playwright);
  });

  test('picker shows owner greeting + "Up to 2 people … 0 already in"',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await expect(page.getByTestId('visitor-name-greeting')).toHaveText(GREETING, {
        timeout: 5_000,
      });
      await expect(page.getByTestId('visitor-name-capacity')).toContainText(
        'Up to 2 people can use this code — 0 already in.',
      );
    });

  test('after one named visitor, fresh scan shows "1 already in"',
    async ({ browser }) => {
      await enterAsName(browser, 'Recruiter Alice');
      // 新 context(无 LS),扫同一张码 → intro 反映 member_count=1。
      const ctx = await browser.newContext();
      const fresh = await ctx.newPage();
      await goto(fresh, `/?code=${CODE}`);
      await expect(fresh.getByTestId('visitor-name-capacity')).toContainText(
        'Up to 2 people can use this code — 1 already in.',
        { timeout: 5_000 },
      );
      await ctx.close();
    });

  test('role without greeting → default "This is <handle>\'s AI…"',
    async ({ page }) => {
      await goto(page, `/?code=${DEFAULT_CODE}`);
      await expect(page.getByTestId('visitor-name-greeting')).toHaveText(
        DEFAULT_GREETING,
        { timeout: 5_000 },
      );
      await expect(page.getByTestId('visitor-name-capacity')).toContainText(
        'Up to 3 people can use this code — 0 already in.',
      );
    });

  test('max_members=1 → singular "Up to 1 person"',
    async ({ page }) => {
      await goto(page, `/?code=${SOLO_CODE}`);
      const cap = page.getByTestId('visitor-name-capacity');
      await expect(cap).toContainText('Up to 1 person can use this code — 0 already in.', {
        timeout: 5_000,
      });
      await expect(cap).not.toContainText('1 people');
    });

  test('unlimited (max_members unset) → falls back to "More than one person…"',
    async ({ page }) => {
      await goto(page, `/?code=${OPEN_CODE}`);
      const cap = page.getByTestId('visitor-name-capacity');
      await expect(cap).toContainText('More than one person can use this code.', {
        timeout: 5_000,
      });
      await expect(cap).not.toContainText('Up to');
    });

  test('invalid code → intro fails, no greeting, picker degrades gracefully',
    async ({ page }) => {
      await goto(page, `/?code=${BAD_CODE}`);
      // picker 仍渲(absorb 无条件吸码);只是 intro 拉不到 → 无 greeting 行 +
      // 名额回落,visitor 还能填名字(submit 才会撞 code_invalid)。
      await expect(page.getByTestId('visitor-name-input')).toBeVisible({
        timeout: 5_000,
      });
      await expectGreetingHidden(page);
      await expect(page.getByTestId('visitor-name-capacity')).toContainText(
        'More than one person can use this code.',
      );
    });
});

async function expectGreetingHidden(page: Page): Promise<void> {
  await expect(page.getByTestId('visitor-name-greeting')).toHaveCount(0);
}

// enterAsName —— 独立 context 走完整入口拿一个具名 member(让 member_count++)。
async function enterAsName(browser: Browser, name: string): Promise<void> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE, name);
  await ctx.close();
}

async function initOwnerWithGreetingCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await seedGreetingCodes(request);
  await request.dispose();
}

async function seedGreetingCodes(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'intro-seed-token');
  await initMCP(request, apiToken);
  const greeter = await createRole(request, csrf, {
    name: 'Greeter',
    description: 'role carrying a custom greeting',
    greeting: GREETING,
    corpus_uris: ['wiki://**', 'output://**'],
  });
  const plain = await createRole(request, csrf, {
    name: 'Plain',
    description: 'role with no greeting — exercises the default',
    corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Code intro greeting test',
    assumed_role_id: greeter.id, max_members: 2,
  });
  await createCode(request, csrf, {
    code: DEFAULT_CODE, label: 'Default greeting',
    assumed_role_id: plain.id, max_members: 3,
  });
  await createCode(request, csrf, {
    code: SOLO_CODE, label: 'Single seat',
    assumed_role_id: greeter.id, max_members: 1,
  });
  await createCode(request, csrf, {
    code: OPEN_CODE, label: 'Unlimited seats',
    assumed_role_id: greeter.id, // max_members 不设 → 无限
  });
}
