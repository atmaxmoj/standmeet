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
// 所以这里没有"素材的权限"这个概念 —— 一个都不该有。有,就说明它脱离了文章。

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import {
  MEDIA, createEntry, uploadAsset, getEntry, visitorRead, assetByID,
} from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'assets-inherit@example.com', password: 'correct-horse-battery-staple',
  handle: 'assets-inherit', fullName: 'Assets Inherit Owner',
};

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;
let csrf: string;

// sessionScoped —— 发一张只授某个 glob 的码,拿它开一个访客会话。
async function sessionScoped(uris: string[], name: string) {
  const role = await createRole(s.request, csrf, {
    name: `assets-${name}-${Date.now()}`, description: 'scoped', corpus_uris: uris,
  });
  const code = await createCode(s.request, csrf, {
    code: `ASSET-${name.toUpperCase()}-${Date.now() % 100000}`,
    label: name, assumed_role_id: role.id,
  });
  return issueSession(s.request, {
    handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: name,
  });
}

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

  test('读得到这条语料 → 它的素材也拿得到', async () => {
    const id = await createEntry(s, 'wiki', 'in scope', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'in.png' });
    const entry = await getEntry(s, 'wiki', id);

    const sess = await sessionScoped(['wiki://**'], 'inscope');
    const read = await visitorRead(s.request, sess, entry.path ?? '');
    const got = read.assets?.find((a) => a.asset_id === up.asset_id);
    expect(got?.url, '能读文章就能拿它的图').toBeTruthy();
  });

  test('读不到这条语料 → 它的素材一份都不给', async () => {
    const id = await createEntry(s, 'wiki', 'out of scope', 'body');
    await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'out.png' });
    const entry = await getEntry(s, 'wiki', id);

    // 只授 output://**,这条 wiki 在范围外。
    const sess = await sessionScoped(['output://**'], 'outscope');
    const read = await visitorRead(s.request, sess, entry.path ?? '');
    expect(read.error, '文章本身就读不到').toBeTruthy();
    expect(read.assets ?? [], '更不会漏素材出去').toHaveLength(0);
  });

  // 要害:素材**没有自己的取用路径**。有的话,它就绕过了文章的 ACL ——
  // owner 把一条 wiki 从某张码上收回,配在里面的图却还拿得到,收回就是假的。
  test('知道 asset id 也没用 —— 素材没有绕开文章的第二条路', async () => {
    const id = await createEntry(s, 'wiki', 'no side door', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'secret.png' });

    const sess = await sessionScoped(['output://**'], 'sidedoor');
    const status = await assetByID(s.request, sess.session_token, up.asset_id);
    expect([401, 403, 404], `按 id 直取应当不通,got ${status}`).toContain(status);
  });

  test('文章从范围里被收回后,之前列出的素材也不再列出', async () => {
    const id = await createEntry(s, 'wiki', 'revoked later', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'revoked.png' });
    const entry = await getEntry(s, 'wiki', id);

    const before = await sessionScoped(['wiki://**'], 'before');
    expect(
      (await visitorRead(s.request, before, entry.path ?? '')).assets?.some((a) => a.asset_id === up.asset_id),
      '收回之前拿得到',
    ).toBe(true);

    // 换一张不授这条的码 —— 同一份素材,同一个 id,这次一份都不该有。
    const after = await sessionScoped(['output://**'], 'after');
    const read = await visitorRead(s.request, after, entry.path ?? '');
    expect(read.assets ?? [], '换一张码就没了').toHaveLength(0);
  });
});
