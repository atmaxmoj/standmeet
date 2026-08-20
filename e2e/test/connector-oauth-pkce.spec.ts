// connector-oauth-pkce.spec.ts —— F-C-44：**dance 必须带 PKCE。**
//
// `calendar-connect` 的 check 2 点名要它：*"the exchange carries the secret, the PKCE verifier
// and the real redirect URI"*。2026-08-20 在 prod 上走了四次真 Google dance，每一次 authorize
// URL 上都只有 `access_type / client_id / prompt / redirect_uri / response_type / scope / state`
// —— **一个 `code_challenge` 都没有**，代码里也零命中。
//
// PKCE 挡的是**授权码被中途截走**：state 管的是 CSRF（那一半有 spec 守着），拿到码的人再
// 拿到 client secret 就能换 token。这个连接器的 redirect 落在明文 HTTP 的 localhost 上，
// 卡上那句话又写着这是一个 Desktop client —— Google 对这一类本来就要求 PKCE。
//
// 两条断言，方向相反，缺一不可：
//   1. authorize URL 上有 `code_challenge` + `code_challenge_method=S256`（发了没有）；
//   2. 整套 dance 能换到 token（发的那个 verifier **对得上**）——
//      替身现在会验 S256，对不上就回 invalid_grant。只断第 1 条的话，发一个随机字符串
//      当 challenge 也能过，而那种「发了但对不上」的实现连一次都成功不了。

import { test, expect } from '@/fixtures/test';

import { getGCalStatus, grantedScopes, initGCalOAuth } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

test.describe('F-C-44 · the OAuth dance carries a PKCE challenge', () => {
  let seed: BaseSeed | undefined;
  test.afterAll(async () => { await teardownSeed(seed); });

  test('authorize sends a S256 challenge, and the exchange still gets a token',
    async ({ playwright }) => {
      test.setTimeout(120_000);
      // seedOwnerGCalConnected 走完整条 dance：init → 跟 302 到 callback → 后端换 token。
      // 它**只有在 verifier 对得上**时才走得完，所以它本身就是第 2 条断言。
      seed = await seedOwnerGCalConnected(playwright);

      const status = await getGCalStatus(seed.request);
      expect(status.connected,
        'the dance completed, so the verifier the product sent matched the challenge')
        .toBe(true);
      expect(await grantedScopes(seed.request),
        'and it came back with a real grant, not an empty one')
        .not.toHaveLength(0);

      // 第 1 条：authorize URL 自己说了什么。再发起一次 init 就能读到（不走完也无妨）。
      const { auth_url: authURL } = await initGCalOAuth(seed.request, seed.csrf);
      const q = new URL(authURL).searchParams;

      expect(q.get('code_challenge_method'),
        'PKCE is S256 — the plain method is no protection at all')
        .toBe('S256');
      expect(q.get('code_challenge') ?? '',
        'and the challenge itself is there')
        .not.toHaveLength(0);
    });
});
