// claim-instance.spec.ts —— first-run claim 流程的真用户路径。
//
// 用户故事：
//   一个全新部署的 StandMeet 实例还没人 claim。owner 打开域名 / —— server
//   端发现 unclaimed → 自动 redirect 到 /setup?t=<token>，token 由 backend
//   把启动时生成的 plaintext 顺着 /api/v1/instance 回吐。owner 填名字 /
//   handle / public_url → 下一步填邮箱密码 → submit → 自动跳到自己的公开页 /。

import type { Page } from '@playwright/test';

import { execSQL, resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Alice Anderson',
  handle: 'alice',
  publicUrl: 'http://localhost:38127',
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('owner claims a fresh instance via /setup', () => {
  test.beforeAll(() => {
    resetInstance();
  });

  test('opening / on a fresh instance lands the owner in the claim wizard and admin',
    async ({ page }) => {
      // 入口 fixture goto('/') 之后：unclaimed → server redirect 到 /setup?t=...
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });

      await fillIdentityStep(page);       // step 1 → 2
      await fillCredentialsStep(page);    // step 2 → 3
      await fillProviderStepSkip(page);   // step 3 → 4 (AI key 可空, admin 后台补)
      await fillVerifyStep(page);         // step 4 → submit
      await expectLandedOnAdmin(page);
    });

  // F-L-56 —— **实例自己发出来的那条 setup 链接，必须真的能 claim。**
  //
  // 真实环境里撞到的（全套 #3 跑到一半，后面 ~130 条用例全部 0ms 死在
  // `claim failed after 3 attempts: 401`）：那台实例发出去的 token 和它自己库里存的 hash
  // **对不上**。当场量过：
  //   hash(API 给的 token) = 21407ef2…   DB 里的 setup_token_hash = 1b8b3f91…
  //
  // 怎么变成这样的：`IssueSetupToken` **先写 DB hash、再设内存 holder**，中间没有锁。
  // 两个并发请求（首页 SSR 每渲一次就问一次 `/api/v1/instance`）交错一次就够：
  //   A 写 hash(TA) → B 写 hash(TB) → B 设 holder=TB → A 设 holder=TA
  // 留下 holder=TA 而 DB=hash(TB)。**而自愈判的是「hash 在 && holder 非空」——
  // 这个坏状态下两个条件都成立**，于是它永远不自愈：owner 那条 `/setup?t=…` 一直 401，
  // 直到有人重启后端。自托管的第一分钟就死在这儿。
  //
  // 这条用例**不去复现那个竞态**（竞态复现是碰运气，[[assertion-that-cannot-fail]] 的反面
  // 也一样糟）。它直接把那个**坏状态**造出来 —— 那才是要守的不变量：
  // **无论内存和库怎么不一致，实例给出去的链接都得能用。**
  test('a setup link the instance hands out always claims, even after the two halves diverge',
    async ({ page }) => { await claimAfterDivergence(page); });
});

// claimAfterDivergence —— 先让它正常发一次（hash 与 holder 同步），再单方面把库里那半改掉：
// 交错之后留下的就是这个形状 —— holder 有值、hash 有值、两者不是一对。
// 然后走 owner 自己那条路，判**好结果**：他进得去后台。
async function claimAfterDivergence(page: Page): Promise<void> {
  resetInstance();
  await goto(page, '/');
  await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
  execSQL(`UPDATE instance_settings SET setup_token_hash = `
    + `'0000000000000000000000000000000000000000000000000000000000000000' WHERE id = 1`);

  await goto(page, '/');
  await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
  await fillIdentityStep(page);
  await fillCredentialsStep(page);
  await fillProviderStepSkip(page);
  await fillVerifyStep(page);
  // 红的时候这里会停在 setup 页上 —— 而 owner 在真实世界里看到的就是那个：
  // 填完一切，然后什么都没发生。
  await expectLandedOnAdmin(page);
}

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
  await page.getByTestId('next').click();
}

async function fillProviderStepSkip(page: Page): Promise<void> {
  // AI provider step 留空（"you can skip this for now and configure later
  // under admin → account" — 设计明示）。直接 next 进 verify。
  await expect(page.getByTestId('setup-ai-key')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('next').click();
}

// fillVerifyStep —— 第 4 步现在只是复核卡，直接提交。
//
// 这里曾经要从页面上抽一道 `a + b =` 算出答案再填。那道算术已经删了（F-H-1）：
// 它**后端不验**（`routes/admin/claim.go` 的 `claimRequest` 没有校验字段），
// 真正的授权是一次性 setup token —— 所以它拦不住任何 bot，只拦得住 owner 自己挂的 agent，
// 而这个产品要的正是能被它纯自动驱动。
async function fillVerifyStep(page: Page): Promise<void> {
  await page.getByTestId('submit').click();
}

// SetupForm 提交成功后 router.push('/admin') —— owner 部署完直接进 admin 开始管理。
// /admin server 端 redirect 到 **/admin/dashboard**（见 app/admin/page.tsx：回访的 owner 要先看
// 全局状态，而不是直接掉进 public-face 编辑器）。这条断言曾经写的是 /admin/page —— 产品改了落地页，
// 测试没跟上，于是它守的是一个已经不存在的行为。
// AdminShell 见到 claim 流程写的 session cookie 即 ready，渲染 sidebar（含 "page" 链接）。
async function expectLandedOnAdmin(page: Page): Promise<void> {
  await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
  await expect(page.getByTestId('admin-nav-page')).toBeVisible();
}
