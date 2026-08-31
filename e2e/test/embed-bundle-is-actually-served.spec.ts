// embed-bundle-is-actually-served.spec.ts —— 我们贴出去的那个地址得指向存在的东西。
//
// 缺陷（2026-08-30）：CLAUDE.md 写着 embed 是"单个 `<script>` 标签 drop-in"，
// `sdk/packages/embed` 也确实构建得出来 —— 但线上 `/embed.js` 和 `/sdk/embed.js`
// 都是 404。没有任何路由在服务它。承诺存在，产物存在，中间那一段不存在。
//
// 这是「ref resolves ≠ ref is a string」那一类：文档里写着一个地址，而没有任何东西
// 验证它指向存在的东西。所以判据不能是"我们记得有个 /embed.js"——
// **要从产品自己给出的那段代码里把 src 取出来，再去访问它**。硬编码路径的话，
// 哪天路径改了、面板跟着改了，这条测试还在验一个没人用的老地址。
//
// 消费者有两个，别混：custom page 用的是构建时内联的那一份（见
// custom-page-html-mode.spec.ts）；这条管的是**别人的网站**那一份。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection, gotoOnHost } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// THIRD_PARTY_HOST —— 解析回本机、但**不是** localhost 的域名（跟
// byoai-insecure-origin.spec.ts 一个手法）。embed 存在的理由就是跑在别人的域名上，
// 而在 localhost 上测跨源什么也证明不了 —— 它是唯一免 TLS 的特权来源
// （[[localhost-is-a-privileged-origin]]）。
const THIRD_PARTY_HOST = 'someones-blog.test';
// EMBED_SRC —— 第三方页面上那一行 <script src>。绝对地址：脚本是从**实例**取的。
//
// 基址跟 navigate fixture 同一个（`APP_BASE_URL`，默认 38127 —— 那是 app 对外的端口；
// 3000 是容器**内**的）。写死 3000 的话失败原因是"连接被拒"，跟这条要验的
// "别人的站点能不能用它"毫无关系。
const EMBED_SRC = `${process.env['APP_BASE_URL'] ?? 'http://localhost:38127'}/embed.js`;

const OWNER = {
  email: 'embedder@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'embedder',
  fullName: 'Emma Embedder',
};

test.use({
  ownerCredentials: { email: OWNER.email, password: OWNER.password },
  launchOptions: { args: [`--host-resolver-rules=MAP ${THIRD_PARTY_HOST} 127.0.0.1`] },
});
test.describe('embed · the snippet we hand out points at something that exists', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('the snippet in api · mcp names a script URL, and that URL serves the bundle',
    async ({ adminPage: page, request }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });

      // 产品自己给 owner 的那段代码 —— 地址从这里取，不写死。
      const snippet = await page.getByTestId('embed-snippet').innerText();
      const m = /src=["']([^"']+)["']/.exec(snippet);
      expect(m, `no script src in the embed snippet:\n${snippet}`).not.toBeNull();
      const src = new URL(m![1]!, page.url()).toString();

      const res = await request.get(src);
      expect(res.status(), `the snippet points at ${src}`).toBe(200);
      // 是 JS，不是被 SPA 兜底成了一张 HTML 页 —— 200 本身证明不了拿到的是脚本。
      expect(res.headers()['content-type'] ?? '').toMatch(/javascript/i);
      // 别人的站点要跨源取它。
      expect(res.headers()['access-control-allow-origin'] ?? '').toBe('*');

      // 而且这份 JS 里得真的注册了那个元素 —— 「拿到了一个 200 的脚本」
      // 和「拿到了 embed」是两件事。
      const body = await res.text();
      expect(body).toContain('standmeet-chat');
      expect(body.length).toBeGreaterThan(1000);
    });

  // 断一个 `access-control-allow-origin: *` 头，跟"别人的站点真的能用它"是两件事。
  // embed 的价值全在**别人的域名上**能跑；脚本取得到而它发的第一个 API 请求被 CORS 挡住，
  // 等于给了一个装得上但用不了的东西。
  test('loaded from a different origin, the element upgrades and its API call is allowed',
    async ({ page, request }) => {
      // 换一个来源打开同一个实例（F-D-14 那条路），在那上面注入 embed 脚本。
      await gotoOnHost(page, THIRD_PARTY_HOST, '/');
      const origin = new URL(page.url()).origin;

      const loaded = await page.evaluate(async (src) => {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script failed'));
          document.head.appendChild(s);
        });
        return customElements.get('standmeet-chat') !== undefined;
      }, EMBED_SRC);
      expect(loaded, 'embed 脚本在第三方来源上没有注册那个元素').toBe(true);

      // 它发的第一个请求是开 session。跨源被挡的话，读者看到的是一个永远转圈的框。
      const preflight = await request.fetch(`${BACKEND}/api/v1/sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status(), `OPTIONS /api/v1/sessions from ${origin}`).toBeLessThan(300);
      expect(preflight.headers()['access-control-allow-origin'] ?? '').not.toBe('');

      const real = await request.post(`${BACKEND}/api/v1/sessions`, {
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        data: { mode: 'public', handle: OWNER.handle, visitor_name: 'Cross Origin Cora' },
      });
      expect(real.status()).toBe(200);
      expect(real.headers()['access-control-allow-origin'] ?? '').not.toBe('');
    });

  test('the snippet also names the element the reader will write',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api-mcp');
      await page.waitForURL('**/admin/api-mcp', { timeout: 5_000 });
      // 光给一个 <script> 标签，owner 还是不知道接下来在页面上写什么。
      await expect(page.getByTestId('embed-snippet')).toContainText('<standmeet-chat');
    });
});
