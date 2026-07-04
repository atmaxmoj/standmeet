// security-oauth-callback-state.spec.ts —— pentest。连接器 OAuth 回程 GET /connectors/{id}/callback
// 是 CSRF 敏感面:攻击者伪造/缺失/不符的 state 不能换到 token(否则可把攻击者的账号绑到 owner 的
// 连接器,或 CSRF 强制授权)。且回程 Location 必须是**常量相对路径**,不能被 state/参数注入成
// 开放重定向。契约:forged state → 302 connect_error=1,Location 不含攻击者 URL。绿=CSRF+重定向门在。

import { test, expect } from '@/fixtures/test';

import { seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.describe('pentest · connector OAuth callback state / open-redirect', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('forged state never mints a token and never open-redirects', async () => {
    const attacks = [
      'code=stolen&state=forged-does-not-match',
      'code=stolen', // missing state entirely
      'code=stolen&state=https://evil.example.com/pwn', // open-redirect attempt via state
    ];
    for (const qs of attacks) {
      // owner-authed (session cookie); a nonexistent connector id is fine — state won't match either way.
      const res = await seed.request.get(
        `${BACKEND}/api/admin/connectors/00000000-0000-0000-0000-000000000000/callback?${qs}`,
        { maxRedirects: 0 },
      );
      // 换 token 失败 → 302 回 connectors 区带 connect_error=1（不是 2xx 成功）。
      expect(res.status(), `no success on forged state: ${qs}`).toBe(302);
      const loc = res.headers()['location'] ?? '';
      expect(loc, `redirect signals failure: ${qs}`).toContain('connect_error=1');
      // 常量相对目标:绝不把攻击者 URL 反射进 Location（开放重定向）。
      expect(loc, `no open-redirect: ${qs}`).not.toContain('evil.example.com');
      expect(loc.startsWith('/'), `Location is a relative path: ${qs} → ${loc}`).toBe(true);
    }
  });
});
