import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// M3 DoD：claim 创建 owner → 错密码登拒绝 → 正确密码登拿 cookie → 用
// cookie 调 /api/admin/me 返 owner → logout → 同 cookie 再调拒绝。
//
// 这个测试 reset 整个 dev stack；不能和其他 spec 并发跑。

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const PASSWORD = 'correct-horse-battery-staple';

function resetInstance(): void {
  execSync(`docker compose ${COMPOSE} down -v`, { stdio: 'inherit' });
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

function findSetupToken(): string {
  const logs = execSync(`docker compose ${COMPOSE} logs backend --no-color`).toString();
  const m = logs.match(/setup\?t=([\w-]+)/);
  if (!m) throw new Error('setup token not found in backend logs');
  return m[1];
}

test.describe.serial('M3 owner login', () => {
  test('claim → wrong pw rejected → right pw issues session → /me works → logout invalidates', async ({
    request,
  }) => {
    resetInstance();

    // Claim 创建 owner（M2 已绿，复用流程）
    const token = findSetupToken();
    const claim = await request.post('/api/admin/claim', {
      data: {
        token,
        email: 'sijie@example.com',
        password: PASSWORD,
        handle: 'sijie',
        full_name: 'Sijie Wang',
      },
    });
    expect(claim.status()).toBe(200);

    // 1. 错密码 → 401
    const bad = await request.post('/api/admin/login', {
      data: { email: 'sijie@example.com', password: 'wrong-pw' },
    });
    expect(bad.status()).toBe(401);

    // 2. 不存在 email → 401（同样不暴露存在性）
    const unknown = await request.post('/api/admin/login', {
      data: { email: 'nobody@example.com', password: PASSWORD },
    });
    expect(unknown.status()).toBe(401);

    // 3. 正确密码 → 200，cookie 设上
    const good = await request.post('/api/admin/login', {
      data: { email: 'sijie@example.com', password: PASSWORD },
    });
    expect(good.status()).toBe(200);
    const goodBody = await good.json();
    expect(goodBody.owner_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(goodBody.csrf_token).toBeTruthy();

    // 检查 Set-Cookie header 有 smt_session + csrftoken
    const setCookies = good.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const cookieJoin = setCookies.map((h) => h.value).join('; ');
    expect(cookieJoin).toContain('smt_session=');
    expect(cookieJoin).toContain('csrftoken=');

    // 4. 用同一个 request context 调 /me（cookie jar 跟着走） → 200 + owner
    const me = await request.get('/api/admin/me');
    expect(me.status()).toBe(200);
    const meBody = await me.json();
    expect(meBody.email).toBe('sijie@example.com');
    expect(meBody.handle).toBe('sijie');
    expect(meBody.full_name).toBe('Sijie Wang');

    // 5. logout → 204
    // logout 是 POST 需要 CSRF header；从 login response 拿 csrf_token 注 header
    const out = await request.post('/api/admin/me/logout', {
      headers: { 'X-Csrftoken': goodBody.csrf_token },
    });
    expect(out.status()).toBe(204);

    // 6. logout 之后再调 /me → 401（session 被 revoke）
    const meAfter = await request.get('/api/admin/me');
    expect(meAfter.status()).toBe(401);
  });
});
