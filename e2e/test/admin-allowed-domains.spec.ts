// admin-allowed-domains.spec.ts —— owner 维护 on-demand TLS 的自定义域名白名单
// （GET/POST/DELETE /api/admin/allowed-domains）。
//
// 这批路由的能力来自**出站收口**（backend/internal/routes/dispatcher）：域出普通函数，
// 收口声明 op，admin 面只负责 REST 形状。所以这个 spec 同时守两件事：
//
//   1. 功能本身 —— 加进去能列出来、删掉就没了、重复删不报错（idempotent）；
//   2. **面自己的契约** —— add / remove 回 204 空身、list 回 200 + {"domains":[...]}。
//      收口给的载荷是一份，状态码是本面的决定；把它们写死在这里，
//      免得下一次搬迁顺手把 204 改成 200 而没人发现（前端按 204 写的）。
//
// 真正的 DNS / TLS 验证走 /internal/tls-ask，不在这个 spec 的范围里。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { login } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DOMAIN = 'me.example.com';

const OWNER = {
  email: 'domains@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'domainsowner',
  fullName: 'Domains Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin allowed domains', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('add → listed → remove → gone（并锁住 204 / 200 的形状）',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        const { csrf } = await login(request, OWNER.email, OWNER.password);

        expect(await listDomains(request)).not.toContain(DOMAIN);

        const added = await request.post(`${BACKEND}/api/admin/allowed-domains`, {
          headers: { 'X-Csrftoken': csrf },
          data: { domain: DOMAIN },
        });
        expect(added.status()).toBe(204);
        expect(await added.text()).toBe('');
        expect(await listDomains(request)).toContain(DOMAIN);

        const removed = await request.delete(
          `${BACKEND}/api/admin/allowed-domains/${DOMAIN}`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(removed.status()).toBe(204);
        expect(await listDomains(request)).not.toContain(DOMAIN);

        // idempotent：删一个不存在的不报错。
        const again = await request.delete(
          `${BACKEND}/api/admin/allowed-domains/${DOMAIN}`,
          { headers: { 'X-Csrftoken': csrf } },
        );
        expect(again.status()).toBe(204);
      } finally {
        await request.dispose();
      }
    });

  test('空域名 → 400，不是 500（收口说“调用方给错了”，本面翻成 400）',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      try {
        const { csrf } = await login(request, OWNER.email, OWNER.password);
        const res = await request.post(`${BACKEND}/api/admin/allowed-domains`, {
          headers: { 'X-Csrftoken': csrf },
          data: { domain: '' },
        });
        expect(res.status()).toBe(400);
        expect(await res.text()).toContain('domain is required');
      } finally {
        await request.dispose();
      }
    });
});

async function listDomains(request: APIRequestContext): Promise<string[]> {
  const res = await request.get(`${BACKEND}/api/admin/allowed-domains`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { domains: string[] };
  return body.domains;
}
