// admin-api-keys-panel.spec.ts —— F-K-1：外发 API key 要能在 admin 里看见、铸出来、吊销掉。
//
// **为什么这是安全线而不是便利**：外发 key 今天只能经 owner-MCP 管理（`api_keys.create/list/
// revoke` 全部 `Reach: mcpOnly()`）。于是一把泄露的 key，**只有在 owner 装好并跑起一个 MCP
// 客户端之后才吊销得掉**。我这一轮吊销自己铸的那几把走的正是这条路，因为没有第二条。
//
// 设计早就判了两个面互为孪生（`docs/design/facade-directions.md:202-206`，逐字）：
//   Admin HTTP: /api/admin/api-keys CRUD (mint returns the secret once) + revoke + rate override…
//   **Admin UI: an "api" section (keys list + mint + revoke; candidates toggle list)**
//   Owner-MCP **twins**: api_keys.create/list/revoke/update…
// 同一页还写着「owner-plane ratchet forces twins by construction」。落地的只有 MCP 那一半，
// 而 `ops/api_keys.go:37` 的 reach 理由反过来写着「the panel has no page for it」—— **拿缺失
// 当依据**。这条守卫钉的就是那个缺的一半。
//
// **断言「铸完之后列表里看不到明文」是这条用例的重点之一**：列表不能变成一个能薅 key 的地方。
// 明文只在铸出来那一瞬间给一次，之后只剩前缀。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'apikeys-panel@example.com', password: 'correct-horse-battery-staple',
  handle: 'apikeyspanel', fullName: 'API Keys Panel Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-K-1 · outward API keys are managed from the admin panel, not only over MCP', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('mint → the secret shows once and the list keeps only the prefix → revoke kills it',
    async ({ adminPage, playwright }) => {
      await goto(adminPage, '/admin/api-mcp');

      // 正对照:这个面板确实渲染出来了。缺了它,下面每一条都会红在"找不到元素"上,
      // 而红的原因会被记到功能缺失头上（[[red-in-the-wrong-place]]）。
      const panel = adminPage.getByTestId('api-keys-panel');
      await expect(panel, 'the api-keys panel is on the page at all').toBeVisible({ timeout: 15_000 });

      await adminPage.getByTestId('api-key-new-label').fill('panel-minted');
      await adminPage.getByTestId('api-key-new-create').click();

      // 明文只给一次 —— 铸出来那一瞬间要看得见,否则 owner 拿不到它。
      const secretBox = adminPage.getByTestId('api-key-new-secret');
      await expect(secretBox, 'the raw secret is shown once, right after minting')
        .toBeVisible({ timeout: 10_000 });
      const secret = (await secretBox.innerText()).trim();
      expect(secret, 'and it is a real smk_ key').toMatch(/^smk_\S{20,}$/);

      // 它是真的能用的 —— 不是一串好看的字符串。
      expect(await facadeStatus(playwright, secret), 'the minted key authenticates').toBe(200);

      // 列表里只剩前缀:这一页不能变成一个能薅 key 的地方。
      //
      // **等那一行本身,不是等面板**:面板带着标题立刻就在,而列表要等一次请求回来。
      // 我第一版等的是 `api-keys-panel` 可见就去读 innerText,读到的是还没填的壳
      // —— 同一个错误今晚犯了两次（[[red-in-the-wrong-place]]）。
      await goto(adminPage, '/admin/api-mcp');
      const revokeBtn = adminPage.getByTestId('api-key-revoke-panel-minted');
      await expect(revokeBtn, 'the key survived the reload and is listed')
        .toBeVisible({ timeout: 15_000 });
      const listed = await adminPage.getByTestId('api-keys-panel').innerText();
      expect(listed, 'but the full secret is not on the page').not.toContain(secret);

      // 吊销 —— 这是这条 finding 的要害:泄露之后 owner 自己就能关掉。
      adminPage.once('dialog', (d) => { void d.accept(); });
      await revokeBtn.click();
      await expect(async () => {
        expect(await facadeStatus(playwright, secret), 'the revoked key stops working').toBe(401);
      }).toPass({ timeout: 15_000 });
    });
});

// facadeStatus —— 拿这把 key 打一次外发面，返回状态码。key 好不好使由**产品自己**回答，
// 不由页面上的字样回答（[[nonunique-signal-not-a-receipt]]）。
async function facadeStatus(playwright: Playwright, secret: string): Promise<number> {
  const r = await playwright.request.newContext();
  const res = await r.get(`${BACKEND}/api/pub/v1/tools`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  await r.dispose();
  return res.status();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createRole(request, csrf, {
    name: 'panel-role', description: 'api keys panel spec',
    corpus_uris: ['wiki://**'],
  });
  await request.dispose();
}

export type { Page };
