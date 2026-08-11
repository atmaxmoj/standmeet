// visitor-client-ip-through-app.spec.ts —— F-F-5。访客的来源地址必须是**访客的**，
// 否则就是不知道 —— 绝不能拿中间那一跳冒充他。
//
// 出厂形态是 浏览器 → app(Next rewrite `/api/:path*`) → backend，中间没人写
// X-Forwarded-For（`make prod-up` 说 "TLS/domain is external"，反代是 owner 自带的）。
// 那时 chi.RealIP 找不到头，RemoteAddr 停在 **app 容器**上，于是每一个访客都被记成
// 同一个地址。后果不是难看：owner 的 conversations 有一栏就叫 IP、ip-bans 页教他
// "Find offending IPs in conversations"，照做就是封掉全部访客；而 per-IP 的暴力锁
// 变成一个全局桶，一个人打错 10 次，所有人 15 分钟进不来。
//
// 这条守卫**必须走 app 那一跳**（BASE_URL），不能直连 backend —— 直连绕开的正是出问题
// 的那一跳。现有的 security-captcha-bypass 直连 :8000 而且自己伪造 XFF，所以它在这个
// 维度上永远不会红。
//
// 两个方向一起断，缺一个都会被"把所有 IP 都清空"这种假修蒙混过去：
//   1) 没有转发头 → 记下来的是空（不知道），不是那一跳的私网地址
//   2) 有转发头   → 记下来的**就是**头里那个地址，一字不差

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const APP = process.env['BASE_URL'] ?? 'http://localhost:38127';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'clientip@example.com',
  password: 'client-ip-pass-123',
  handle: 'clientip',
  fullName: 'Client IP Owner',
};

// A documentation-range address (RFC 5737) — it can only have come from the header.
const FORWARDED = '203.0.113.9';

// owner —— beforeAll 里登录过的那个 context（带着会话 cookie）。admin 读一律走它。
let owner: APIRequestContext;
let csrf = '';

// issueThroughApp —— 经 app 那一跳开一个会话。headers 留空 = 出厂形态（无转发头）。
async function issueThroughApp(
  request: APIRequestContext, code: string, visitor: string,
  headers: Record<string, string>,
): Promise<void> {
  const res = await request.post(`${APP}/api/v1/sessions`, {
    headers, data: { handle: OWNER.handle, mode: 'code', code, visitor_name: visitor },
  });
  expect(res.status(), 'session issued through the app hop').toBe(200);
}

// recordedIP —— owner 在 /admin/conversations 那一栏里看到的来源 IP。按访客名取行：
// 这一栏正是 ip-bans 页让 owner 去复制的东西，所以断言要断在他真看得见的那份数据上。
async function recordedIP(visitor: string): Promise<string> {
  const res = await owner.get(`${BACKEND}/api/admin/conversations`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), 'owner lists conversations').toBe(200);
  const rows = await res.json() as Array<{ visitor_name: string; client_ip: string }>;
  const row = rows.find((r) => r.visitor_name === visitor);
  expect(row, `a row for ${visitor}`).toBeDefined();
  return row?.client_ip ?? '<no row>';
}

test.describe('F-F-5 · the visitor address is the visitor, or it is unknown', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s，而钩子默认只给 30s
    resetInstance();
    owner = await playwright.request.newContext();
    await claim(owner, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(owner, OWNER.email, OWNER.password));
    const apiToken = await createAPIToken(owner, csrf, 'client-ip-seed');
    const sid = await initMCP(owner, apiToken);
    await seedPublicWiki(owner, apiToken, sid, {
      body: 'client ip intro.', title: 'Client IP Intro', path: 'clientip/intro',
    });
    await createCode(owner, csrf, { code: 'CLIENTIP-1', label: 'clientip' });
  });

  test.afterAll(async () => { await owner.dispose(); });

  test('no forwarding header through the app hop → the address is unknown, not the hop',
    async ({ playwright }) => {
      const visitor = await playwright.request.newContext();
      await issueThroughApp(visitor, 'CLIENTIP-1', 'Unforwarded', {});
      // 红在这一行：今天记下来的是 app 容器的私网地址（172.x），于是所有访客同一个值。
      expect(await recordedIP('Unforwarded'),
        'an unknowable address is recorded as unknown, never as the proxy hop').toBe('');
      await visitor.dispose();
    });

  test('a forwarding header through the app hop → that exact address is recorded',
    async ({ playwright }) => {
      const visitor = await playwright.request.newContext();
      await issueThroughApp(
        visitor, 'CLIENTIP-1', 'Forwarded', { 'X-Forwarded-For': FORWARDED },
      );
      // 反向断言：修法不能是"把 IP 一律清空"—— 有真地址时必须原样留下，
      // 否则 owner 的封禁能力就被修没了。
      expect(await recordedIP('Forwarded'),
        'a forwarded address survives the hop unchanged').toBe(FORWARDED);
      await visitor.dispose();
    });
});
