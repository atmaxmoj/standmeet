// connector-spec-fetch-names-the-refusal.spec.ts —— F-C-23:被 SSRF 闸门挡下的抓取,不许说成
// 「是不是连不上?」。
//
// 真实环境里驱出来的:在 prod 的 add-connector 面板里把 spec URL 填成同一个 docker 网络上的
// `http://standmeet-prod-app-1:3000/`,面板回 *"could not fetch the spec from that URL
// (is it reachable?)"*。那个地址**确凿可达** —— 从后端容器里 wget 拿到 200 OK。所以那是闸门
// 按策略拒绝,却把 owner 支去排查自己的网络。同一个代码库里的兄弟端点早就分开了
// (`inference_models.go` 的 `endpoint_blocked`)。
//
// 两条断言缺一不可,而且是**相反方向**的:
//   1. 内网地址 → 那句话必须点名「地址策略」;
//   2. 解析不了的公网域名 → 那句话必须**仍然**是可达性,不许被一并改口。
// 只断第 1 条的话,一个「所有抓取失败都改说内网」的偷懒修法也能过 —— 那是把谎换个方向,
// 而且更糟:owner 会去找一个根本不存在的内网问题。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// PRIVATE_URL —— 字面私网 IP:静态判定,不经 DNS,所以既快又没有解析这一层的歧义。
const PRIVATE_URL = 'http://10.255.255.1/openapi.json';
// UNRESOLVABLE_URL —— `.invalid` 是保留 TLD,永远解析不了。它**不是**内网地址。
const UNRESOLVABLE_URL = 'https://standmeet-verify-no-such-host.invalid/openapi.json';

// NAMES_THE_ADDRESS —— 断的是「这句话说出了地址策略」,不是某个具体措辞:措辞是产品的选择,
// 说得出来才是不变量。
const NAMES_THE_ADDRESS = /internal|private|not allowed/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function fetchSpecFrom(page: Page, url: string): Promise<void> {
  await page.getByTestId('connector-spec-url-input').fill(url);
  await page.getByTestId('connector-spec-fetch-button').click();
}

test.describe('connector · spec fetch names which refusal it is', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimOwner(playwright);
  });

  // 内网地址 → 说出地址策略;解析不了的域名 → 仍然说可达性(两个方向缺一不可,见文件头)。
  test('internal address names the address policy; unresolvable host still says reachability',
    async ({ adminPage: page }) => {
    test.setTimeout(180_000);
    // 从 sidebar 走进去(不 page.goto),跟 connector-spec-ingest 同一条入口。
    await page.getByTestId('admin-nav-connectors').click();
    await page.waitForURL('**/admin/connectors**');
    await page.getByTestId('connector-add-open').click();

    const err = page.getByTestId('connector-spec-error');

    // 1) 被闸门挡下的那一种。
    await fetchSpecFrom(page, PRIVATE_URL);
    await expect(err).toBeVisible({ timeout: 30_000 });
    // 非空守卫:先证这条错误真的在说话,否则空文本也能让下面的判定看起来讲得通。
    await expect(err).not.toHaveText('');
    await expect(err).toHaveText(NAMES_THE_ADDRESS);

    // 2) 真的连不上的那一种 —— 不许被一并改口成「内网」。
    await fetchSpecFrom(page, UNRESOLVABLE_URL);
    await expect(err).toBeVisible({ timeout: 30_000 });
    await expect(err).not.toHaveText('');
    await expect(err).not.toHaveText(NAMES_THE_ADDRESS);
  });
});
