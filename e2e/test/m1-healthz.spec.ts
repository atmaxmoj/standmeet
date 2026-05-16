import { test, expect } from '@playwright/test';

// M1 DoD：docker compose 起 backend + db + redis 后，/internal/healthz 返
// {db, redis, ok=true} 且状态 200。这是 toolchain 闭环的最小验收 ——
// 证 go-build + chi 路由 + pgx pool + go-redis client + dev compose 都活着。

test('GET /internal/healthz returns 200 with all deps ok', async ({ request }) => {
  const res = await request.get('/internal/healthz');
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toEqual({
    db: 'ok',
    redis: 'ok',
    ok: true,
  });
});
