// visitor-dead-session-recovery.spec.ts —— 后端 session 失效(401)时不能再
// blithe 地拿着 localStorage 里的旧身份装作还登录着。
//
// 后端 session 是唯一 source of truth:token 一旦被拒(过期 / 实例重置 / 撤销),
// 客户端就得清掉旧身份(名字 + 配额 + 凭据),按手里还有没有 access code 回入口:
//   - 有 code → 重新弹名字选择器(像第一次进来那样问名字、开一段全新的会)
//   - 没 code → 退回 /gate
//
// 这里测「有 code」分支:进会后把 localStorage 里的 session_token 弄成死值,reload
// → 名字选择器必须重新弹出,且旧凭据已清。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'DEAD-001';
const NAME = 'Hana';
const CREDS_KEY = 'standmeet:visitor-session';
const DISPLAY_KEY = 'standmeet-session';

test.describe('session 失效 → 清旧身份,按有没有 code 回入口', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'dead-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('死 token + reload → 有 code 就重弹名字选择器,旧凭据清掉', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);

    // 进会后名字选择器已关、strip 显身份。
    await expect(page.getByTestId('visitor-name-overlay')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('session-strip-gauge')).toBeVisible({ timeout: 10_000 });

    // 把 chat 鉴权 token 弄成死值(模拟过期 / 实例重置)。
    await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      if (raw === null) throw new Error('no creds in localStorage');
      const parsed = JSON.parse(raw) as { session_token: string };
      parsed.session_token = 'dead-token-deadbeef';
      window.localStorage.setItem(key, JSON.stringify(parsed));
    }, CREDS_KEY);

    // reload → snapshot 拿死 token 打后端 → 401 → 清身份 + 因为 code 还在,重新
    // 把 code 塞回 pending → 名字选择器重新弹出。
    await page.reload();
    await expect(page.getByTestId('visitor-name-overlay')).toBeVisible({ timeout: 15_000 });

    // 旧凭据已清(死 token 不再留着反复打后端);展示身份也清了。
    const creds = await page.evaluate((key) => window.localStorage.getItem(key), CREDS_KEY);
    expect(creds).toBeNull();
    const display = await page.evaluate((key) => window.localStorage.getItem(key), DISPLAY_KEY);
    expect(display).toBeNull();

    await ctx.close();
  });
});
