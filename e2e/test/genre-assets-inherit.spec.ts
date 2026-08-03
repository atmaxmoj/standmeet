// genre-assets-inherit.spec.ts —— 素材**依附于文章**:可见性纯继承,自己没有一套。
//
// 一份素材不是独立的东西,它是某条语料身上的。所以:
//
//	读得到这条语料  → 它的素材也拿得到
//	读不到这条语料  → 它的素材一份都拿不到,**知道 id 也不行**
//
// 后半句才是要害。素材如果有自己的取用路径(按 asset id 直接换地址),那条路就绕过了语料的
// ACL —— owner 把一条 wiki 收回不给某张码看,配在里面的图却还能拿,收回就是假的。
// 这跟"blob 的寿命 ⊆ 条目的寿命"是同一条不变量的另一半:**可见性也 ⊆ 条目的可见性**。
//
// # 这里为什么只剩两条
//
// 原来有四条,全部从 `POST /api/v1/sessions/{id}/tools/corpus_read` 断。那不是端 ——
// 没有访客会发那个 POST,发它的是页面里的 JS。而且素材的泄漏**发生在渲染层**:文件名、
// 缩略图、渲不出来的破图位,任何一个漏出去都算,在 JSON 里一个都看不见。
// 正向那两条("读得到就拿得到"/"读不到就不给")现在由 genre-assets-reader.spec.ts 在
// **浏览器里**断,比这边的 JSON 断言严格,所以删掉,不留一份更弱的重复。
//
// 剩下这两条留在这一层,各有各的理由,见每条自己的注释。

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import {
  MEDIA, createEntry, uploadAsset, getEntry, assetByID,
} from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'assets-inherit@example.com', password: 'correct-horse-battery-staple',
  handle: 'assets-inherit', fullName: 'Assets Inherit Owner',
};

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;
let csrf: string;

test.describe('素材依附文章:可见性纯继承', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    const token = await createAPIToken(request, csrf, 'assets-inherit-token');
    s = { request, token, sid: await initMCP(request, token) };
  });

  test.afterAll(async () => { await s.request.dispose(); });

  // 这一条**不可能**驱 UI,而且这正是它要证的事:它断言的是"某条路不存在"。
  // 界面上没有任何按钮通向一条不存在的路 —— 会去敲它的是打开了开发者工具的人,
  // 那时 HTTP 表面就是他的端。所以直接发这个请求是**正确的形态**,不是抄近路。
  test('知道 asset id 也没用 —— 素材没有绕开文章的第二条路', async () => {
    const id = await createEntry(s, 'wiki', 'no side door', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'secret.png' });

    const sess = await sessionScoped(['output://**'], 'sidedoor');
    const status = await assetByID(s.request, sess.session_token, up.asset_id);
    expect([401, 403, 404], `按 id 直取应当不通,got ${status}`).toContain(status);
  });

  // 撤回:同一条语料、同一份素材、同一个 id,换一张不授它的码,访客页面上应当什么都没有。
  // 这条走浏览器 —— 撤回失灵的样子是**页面上还渲着那张图**,而不是某个 JSON 数组还有值。
  test('文章从范围里被收回后,访客页面上那张图也没了', async ({ page }) => {
    const id = await createEntry(s, 'wiki', 'revoked later', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'revoked.png' });
    await setBodyImage(id, up.asset_id);
    const path = (await getEntry(s, 'wiki', id)).path ?? '';

    const [openCode, shutCode] = await issueTwoCodes();

    // 授了的那张:图在。
    await enterCodeSession(page, openCode, 'Before');
    await goto(page, `/wiki/${path}`);
    const img = page.getByTestId('wiki-body').locator('img').first();
    await expect(img, '收回之前图渲得出来').toBeVisible({ timeout: 8_000 });
    expect(await img.getAttribute('src') ?? '', '就是那份素材').toContain(up.asset_id);

    // 换一张不授的:整页没有这份素材的任何痕迹。
    await enterCodeSession(page, shutCode, 'After');
    await goto(page, `/wiki/${path}`);
    await expect(page.getByTestId('wiki-locked'), '换一张码就进不去了')
      .toBeVisible({ timeout: 8_000 });
    const html = await page.content();
    expect(html, '连素材 id 都不该出现').not.toContain(up.asset_id);
    expect(html, '文件名也不该漏').not.toContain('revoked.png');
  });
});

async function setBodyImage(id: string, assetID: string): Promise<void> {
  await callTool(s.request, s.token, s.sid, 'corpus.update', {
    genre: 'wiki', id, title: 'revoked later',
    body: `before revoke: ![shot](standmeet-asset:${assetID})`,
  });
}

// issueTwoCodes —— 一张授这条 wiki,一张不授。**同一条语料**,只有码不同 ——
// 差别只能来自可见性,不能来自"这两条本来就不一样"。
async function issueTwoCodes(): Promise<[string, string]> {
  const open = await codeFor(['wiki://**'], 'open');
  const shut = await codeFor(['output://**'], 'shut');
  return [open, shut];
}

async function codeFor(uris: string[], name: string): Promise<string> {
  const role = await createRole(s.request, csrf, {
    name: `assets-${name}`, description: 'scoped', corpus_uris: uris,
  });
  const code = await createCode(s.request, csrf, {
    code: `ASSETINH-${name.toUpperCase()}`, label: name, assumed_role_id: role.id,
  });
  return code.code;
}

// sessionScoped —— 发一张只授某个 glob 的码,拿它开一个访客会话(给上面那条侧门探测用:
// 它要的是一个**合法的 token**,证明"即使带着有效凭据,按 id 直取也不通")。
async function sessionScoped(uris: string[], name: string) {
  const code = await codeFor(uris, name);
  return issueSession(s.request, {
    handle: OWNER.handle, mode: 'code', code, visitor_name: name,
  });
}
