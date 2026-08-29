// admin-system-upgrade.spec.ts —— /admin/system 那一格「升级」。
//
// 它替换掉的是一个**接不上的按钮**:顶栏那个 `check for updates` 没有 onClick,
// 也没有后端可问 —— 点它什么都不会发生,而"可见"这一类断言看不出区别
// ([[button-that-cannot-be-wired]])。所以这里的判据是**点下去之后页面上多了什么**。
//
// 第二条守的是诚实:dev 没配 STANDMEET_REDEPLOY_HOOK —— 这台实例没有宿主控制权,
// 按不动。这种时候按钮不许写成「升级」。提供一个做不到的动作,比不提供更坏,
// 而且它让整条流程静默失败。
//
// 镜像库走 mock(STANDMEET_RELEASE_REGISTRY),它宣称发过 v9.9.9 —— 比任何真版本都新,
// 于是"有新版"这一态稳定可达,不随真实发布节奏漂。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'upgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgrader', fullName: 'Upgrade Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('/admin/system · upgrade', () => {
  test.beforeEach(async ({ request }) => {
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
  });

  test('按下去真的问了镜像库，而不是一个接不上的按钮', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'system');
    const panel = page.getByTestId('system-upgrade');
    await expect(panel).toBeVisible();

    // 点之前:实例还没查过。取文本再判 —— `.not.toContainText` 在元素还没出现时
    // 也算通过（[[negated-assertion-passes-while-absent]]）。
    const line = page.getByTestId('upgrade-line');
    await expect(line).toBeVisible();
    expect(await line.innerText(), '还没查过的时候不许已经在说版本')
      .not.toContain('9.9.9');

    await page.getByTestId('upgrade-button').click();

    // 查完:mock 宣称发过 v9.9.9，页面必须说出那个数。这一句只有在
    // 「按钮接上了 + 后端真去问了镜像库」两件事都成立时才会出现。
    await expect(line, '查完要说出镜像库那边最新是哪一版')
      .toContainText('9.9.9', { timeout: 20_000 });
  });

  test('这台实例按不动的时候，按钮不许写成「升级」', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'system');
    await page.getByTestId('upgrade-button').click();

    const line = page.getByTestId('upgrade-line');
    await expect(line).toContainText('9.9.9', { timeout: 20_000 });

    // dev 没配重新部署的 hook —— 有新版，但这台实例自己做不到。
    const label = await page.getByTestId('upgrade-button').innerText();
    expect(label.toLowerCase(), '按不动就不许把按钮写成升级')
      .not.toContain('upgrade to');
    await expect(line, '要说清为什么按不动，以及该怎么升')
      .toContainText('cannot apply it itself');
  });
});
