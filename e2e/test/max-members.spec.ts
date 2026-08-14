// max-members.spec.ts —— 名字上限的完整浏览器流(defer-issue + 名字选择器 +
// 满额拒绝 + "N of M names" 展示 + 同名续会 + 名字 localStorage 预填)。
//
// 用户故事:
//   owner 发 TEAM-2(max_members=2)。Alice 扫码选名进来,strip 显 "1 / 2 names"。
//   Bob 扫同码、不同名进来 → "2 / 2 names"。第三个人(Carol)扫同码选名 →
//   "code 已满",进不来。Alice 再扫(同名)→ 续会、照常进。
//   名字存了 localStorage:同浏览器再开,名字选择器自动预填上次的名字。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'maxmembers-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'maxmembersowner',
  fullName: 'Max Members Owner',
};

const CODE = 'TEAM-2';
// 单独一张不限名额的码给"名字预填"用 —— TEAM-2 在第一个 test 里已经填满。
const PREFILL_CODE = 'PREFILL-ANY';

test.describe('max_members: code caps how many names, with a clear full state', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('2 names fill the code, 3rd sees "code full", existing name resumes',
    async ({ browser }) => {
      // Alice(名字 1)→ 进得来,strip 显 1 / 2 names。
      const aliceCtx = await browser.newContext();
      const alice = await aliceCtx.newPage();
      await enterCodeSession(alice, CODE, 'Alice');
      await expect(alice.getByTestId('session-strip-members-used')).toHaveText('1');
      await expect(alice.getByTestId('session-strip-names')).toContainText('/ 2');

      // Bob(名字 2)→ 进得来,2 / 2。
      const bobCtx = await browser.newContext();
      const bob = await bobCtx.newPage();
      await enterCodeSession(bob, CODE, 'Bob');
      await expect(bob.getByTestId('session-strip-members-used')).toHaveText('2');

      // Carol(名字 3)→ 满了,名字选择器显 "code full",没 session。
      const carolCtx = await browser.newContext();
      const carol = await carolCtx.newPage();
      await goto(carol, `/?code=${CODE}`);
      await carol.getByTestId('visitor-name-input').fill('Carol');
      await carol.getByTestId('visitor-name-submit').click();
      await expect(carol.getByTestId('visitor-name-full')).toBeVisible({ timeout: 10_000 });
      await expect(carol.getByTestId('session-strip')).toBeHidden();

      // Alice 同名再扫 → 续会,照常进(不占新名额)。
      const alice2Ctx = await browser.newContext();
      const alice2 = await alice2Ctx.newPage();
      await enterCodeSession(alice2, CODE, 'Alice');
      await expect(alice2.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      await aliceCtx.close();
      await bobCtx.close();
      await carolCtx.close();
      await alice2Ctx.close();
    });

  test('name is remembered in localStorage and pre-filled when a NEW code re-asks',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // 第一次:选名 Dana 进来(用不限名额的码)。名字落进 localStorage。
      await enterCodeSession(page, PREFILL_CODE, 'Dana');
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // **同一张码**再扫不会重弹选择器 —— F-A-5 有意为之（absorbFromURL 的 alreadyInNamedSession）：
      // 重开 ?code= 链接不该把身份选择器盖在活跃会话上。所以「预填」要在它真的会弹的场景里验：
      // 换一张**新码**（新场景 → clearNameDismiss → 选择器重问），输入框预填上次的 Dana。
      await goto(page, `/?code=${CODE}`);
      await expect(page.getByTestId('visitor-name-input')).toHaveValue('Dana');
      await ctx.close();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'maxmembers-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, { body: 'team intro.', title: 'Intro' });
  await createCode(request, csrf, {
    code: CODE, label: 'Team of 2', max_members: 2,
  });
  await createCode(request, csrf, { code: PREFILL_CODE, label: 'Prefill (unlimited)' });
  await request.dispose();
}
