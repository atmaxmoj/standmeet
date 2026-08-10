// setup-wizard-4step.spec.ts —— first-run claim 的 4-step 向导。
//
// 业务故事：
//   step 1 identity → step 2 credentials → step 3 AI provider (可跳过) →
//   step 4 verify (arithmetic captcha + summary 卡) → submit → /admin。
//   step progress bar 4 段；back / next / submit 按钮 testid 跨 step 复用。
//
// Playwright test isolation：每个 test 拿到的是 fresh page (即使
// describe.serial)。每个 case 自己走完前置 steps，避免假设跨 case 状态共享。

import type { Page } from '@playwright/test';

import { resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  full: 'Sijie Wang',
  handle: 'sijie',
  publicUrl: 'http://localhost:38127',
  email: 'sijie@example.com',
  password: 'correct-horse-battery-staple',
};

test.describe('first-run claim · 4-step wizard polish', () => {
  test.beforeEach(() => { resetInstance(); });

  test('step 1 missing fields → next disabled; fill → enabled + advance',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      const nextBtn = page.getByTestId('next');
      await expect(nextBtn).toBeDisabled();
      await fillStep1(page);
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();
      await expect(page.getByTestId('email')).toBeVisible({ timeout: 5_000 });
    });

  test('step 2 password mismatch error; correct → step 3',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await page.getByTestId('email').fill(OWNER.email);
      await page.getByTestId('password').fill(OWNER.password);
      await page.getByTestId('password-confirm').fill('wrong');
      await page.getByTestId('next').click();
      await expect(page.getByTestId('error')).toContainText(/don.t match/i);
      await page.getByTestId('password-confirm').fill(OWNER.password);
      await page.getByTestId('next').click();
      await expect(page.getByTestId('setup-ai-key')).toBeVisible({ timeout: 5_000 });
    });

  test('full flow with captcha → /admin',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await page.getByTestId('next').click(); // skip provider
      await submitReview(page);
      // /admin 落地 = dashboard（app/admin/page.tsx 的 server redirect）。
      await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
    });

  // F-H-2：第 3 步收的 key **必须真的落地**。
  //
  // 这条以前没人守：既有的两条 full-flow 用例都在第 3 步直接 next（"可跳过"），
  // 于是"填了会怎样"从来没被问过 —— 而重建实例那次真填了，结果 review 卡照印
  // `AI · DeepSeek · deepseek-chat`，claim 也成功，key 却一个字都没写进去。
  //
  // 断言落在 **owner 后面看得到的那个面**（/admin/api·mcp），不是 claim 的响应：
  // owner 判断"配好了没"看的就是这个面，而 endpoint 回填成 deepseek 的 base URL
  // 恰好证明 provider 也跟着落地了（那个值这一步压根没让 owner 输过）。
  test('the AI key typed at step 3 is configured by the time the wizard lands in admin',
    async ({ page }) => {
      await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });
      await fillStep1(page);
      await page.getByTestId('next').click();
      await fillStep2(page);
      await page.getByTestId('next').click();
      await fillStep3Provider(page);
      await page.getByTestId('next').click();
      await submitReview(page);
      await page.waitForURL('**/admin/dashboard', { timeout: 10_000 });
      await gotoAdminSection(page, 'api-mcp');
      await expectProviderOnFile(page);
    });

  // 这里曾经有一条 `wrong captcha → error, stays on /setup`。**那个不变量随控件一起没了**
  // （F-H-1：算术框后端不验，拦不住 bot 只拦得住 owner 的 agent，已删）。
  //
  // 补上真正该守的那一条：**坏 setup token 必须被拒**。那才是这一步的授权 ——
  // 一次性 token 打印在后端日志里，只有能读服务器的人拿得到，而且它是**服务端验**的。
  //
  // 验在 API 层而不是走 GUI：换一个 token 就得换 URL，而 e2e 的 lint 禁 `page.goto`
  // （要求从已知入口点点进去，这条规则是对的）。**换 token 这件事本来就属于 API 层** ——
  // GUI 那条路上 token 是环境给的，测不出"另一个 token"。
  test('a bad setup token is refused by the server', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/admin/claim`, {
      data: {
        token: 'not-a-real-setup-token',
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, full_name: OWNER.full, public_url: OWNER.publicUrl,
      },
    });
    expect(res.status(), 'a forged setup token must not claim the instance').toBe(401);
    const body = await res.json() as { error?: { code?: string } };
    expect(body.error?.code, 'and the refusal names what was wrong').toBe('invalid_setup_token');
  });
});

async function fillStep1(page: Page): Promise<void> {
  await page.getByTestId('full').fill(OWNER.full);
  await page.getByTestId('handle').fill(OWNER.handle);
  await page.getByTestId('public-url').fill(OWNER.publicUrl);
}

async function fillStep2(page: Page): Promise<void> {
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('password-confirm').fill(OWNER.password);
}

async function fillStep3Provider(page: Page): Promise<void> {
  await page.getByTestId('setup-provider-deepseek').click();
  await page.getByTestId('setup-ai-model').fill('deepseek-chat');
  await page.getByTestId('setup-ai-key').fill('sk-setup-wizard-fake-key');
}

// expectProviderOnFile —— 在 /admin/api·mcp 上确认第 3 步那份配置真的在库里。
// endpoint 是判据里最硬的一条：这一步从没让 owner 输过它，它只能是服务端按
// provider 从 preset 表查出来的。
async function expectProviderOnFile(page: Page): Promise<void> {
  await expect(
    page.getByTestId('ai-provider-key'),
    'the key from step 3 must be on file, not thrown away',
  ).toHaveAttribute('placeholder', /already set/);
  await expect(page.getByTestId('ai-provider-endpoint'))
    .toHaveValue('https://api.deepseek.com');
  await expect(page.getByTestId('ai-provider-model')).toHaveValue('deepseek-chat');
}

// submitReview —— 第 4 步现在只是复核卡，直接提交（算术框已删，见 F-H-1）。
async function submitReview(page: Page): Promise<void> {
  await page.getByTestId('submit').click();
}
