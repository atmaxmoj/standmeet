// security-spec-dos.spec.ts —— pentest。connector spec 摄入(POST /connectors/validate-spec)
// 解析 owner 贴的任意 OpenAPI 文本。恶意 spec 不能拖垮解析:超大体(>4MiB)被 LimitReader 截、
// 深嵌套不栈溢出、YAML 别名炸弹(billion-laughs)不指数膨胀 OOM。契约:每个都**及时**返回
// 400 或 200{ok:false},绝不 hang、绝不 ok:true。绿=解析有界;红=一个恶意 spec 就能 DoS 实例。

import { test, expect } from '@/fixtures/test';

import { seedOwnerLoggedIn, teardownSeed, type BaseSeed } from '@/fixtures/gcal-setup';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// billion-laughs:YAML 别名指数展开。安全解析器不展开/有界 → 拒。
const BILLION_LAUGHS = [
  'a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]',
  'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
  'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
  'openapi: "3.0.0"',
  'info: {title: boom, version: "1", x: *e}',
].join('\n');

const DEEP_NEST = '{"openapi":"3.0.0","x":' + '['.repeat(100000) + ']'.repeat(100000) + '}';
const OVERSIZE = '{"openapi":"3.0.0","pad":"' + 'A'.repeat(5 << 20) + '"}'; // >4 MiB body cap

test.describe('pentest · connector spec-ingest DoS resistance', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  for (const [name, spec] of [
    ['billion-laughs YAML aliases', BILLION_LAUGHS],
    ['100k-deep nesting', DEEP_NEST],
    ['oversize body (>4MiB)', OVERSIZE],
  ] as const) {
    test(`malicious spec is bounded, not a hang: ${name}`, async () => {
      // 15s hard cap: 有界解析远快于此;若 hang(真 DoS)则超时 → 红。
      // 安全 probe 刻意绕过 UI 直打原始 API —— 这正是攻击者视角(DoS 边界),故 disable UI-write 规则。
      /* eslint-disable no-restricted-syntax */
      const res = await seed.request.post(`${BACKEND}/api/admin/connectors/validate-spec`, {
        headers: { 'X-Csrftoken': seed.csrf },
        data: { spec, url: '' },
        timeout: 15_000,
      });
      /* eslint-enable no-restricted-syntax */
      // 坏体 → 400;能解析但非法 → 200{ok:false}。都可接受;绝不 5xx 崩、绝不 ok:true。
      expect(res.status(), `${name}: no 5xx crash`).toBeLessThan(500);
      if (res.status() === 200) {
        const body = await res.json() as { ok?: boolean };
        expect(body.ok, `${name}: malicious spec never validates OK`).not.toBe(true);
      }
    });
  }
});
