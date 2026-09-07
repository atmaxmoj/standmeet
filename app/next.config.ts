import { fileURLToPath } from 'node:url';
import path from 'node:path';

import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// rewrites/proxies /api/* 到 backend，避免在浏览器配 CORS（dev + docker
// 同样的 rewrite 让 SSR 和客户端 fetch 用同一个相对路径）。
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://backend:8000';

// outputFileTracingRoot 指 workspace 根（app/ 的父）。pnpm 把 next 等放在
// 仓库根的 .pnpm 虚拟 store，trace root 必须覆盖到那里，否则 standalone
// bundle 里的 node_modules/next 只剩 dist/ 没 package.json，运行时
// require('next') 直接 MODULE_NOT_FOUND。
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(APP_DIR, '..');

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: WORKSPACE_ROOT,
  // proxyTimeout —— rewrite 反代的上限。Next 的默认值是 **30 秒**，而 owner 唯一那条路
  // （浏览器 → 这个 app → backend）上有一个耗时随他的库大小长的操作：vault 导入。
  // 真 vault（1082 篇）直连后端实测 **50 秒** —— 也就是说默认值下它必然被砍。
  //
  // 砍断的样子很难认：代理掐掉连接，浏览器拿到一个网络错误，而后端那一侧**已经写了一半**
  // （日志里是 "context canceled"，import 提前收尾并返回 200）。owner 读到「失败」，
  // 于是再导一次 —— 而库里已经是半成品。
  //
  // 跟 F-L-20（1000 个 part 的墙）、F-L-69（后端 30s WriteTimeout）是同一族：
  // 一个没人声明过的默认值，让真实规模的 vault 用不了。真正的上限交给后端的 ctx。
  // staleTimes.dynamic —— the whole /admin tree is DYNAMIC (the root layout awaits headers()/cookies()
  // for i18n), and Next 15's default `staleTimes.dynamic = 0` throws away the prefetched loading shell
  // the moment it's fetched. So clicking a sidebar section (or the "编辑" link) can't reuse a cached
  // shell: the router blocks on a server RSC round-trip while holding the OLD screen, and admin/loading.tsx
  // never gets a frame to paint ("点了好久才变，没 skeleton"). A positive TTL lets the router serve the
  // already-prefetched loading skeleton INSTANTLY on click, then stream the section behind it. Only the
  // skeleton shell is cached (real data is fetched client-side on mount), so there's no stale-data risk.
  // ponytail: 180s is a tuning knob; lower it if a route's shell ever embeds must-be-fresh server data.
  experimental: { proxyTimeout: 15 * 60 * 1000, staleTimes: { dynamic: 180 } },
  // node-tikzjax(/render-tikz 用):(1) 保持 external 不被 Next 打进 route bundle —— 否则
  // __dirname 变、它读的 ../tex/*.gz 找不着;(2) 显式 trace-include 那 3 个运行时 TeX 资产
  // (core.dump.gz / tex.wasm.gz / tex_files.tar.gz 是 fs.read 的,不走 import,tracing 抓不到)。
  serverExternalPackages: ['node-tikzjax'],
  // happy-dom is dead code here: it's pulled in transitively by Puck's built-in RichText field (via
  // @tiptap/html's SERVER HTML parser), but this app only ever runs Tiptap in the browser with a real
  // DOM (the writings editor) — it never calls @tiptap/html's server path, so happy-dom is never
  // executed. Left bundled, its FetchHTTPSCertificate self-signed test cert lands in the composer
  // chunk and trips the release secret scan. serverExternalPackages can't reach it (Puck is a client
  // component, so happy-dom rides in the client-component graph, not the server-components one), so
  // alias it to an empty module — excluded from every bundle, client and server.
  webpack: (config: { resolve: { alias?: Record<string, string | false> } }) => {
    config.resolve.alias = { ...config.resolve.alias, 'happy-dom': false };
    return config;
  },
  outputFileTracingIncludes: {
    '/render-tikz': ['../node_modules/.pnpm/node-tikzjax@*/node_modules/node-tikzjax/tex/**'],
  },
  // 把 data-testid="..." attribute 在 production release build 里全删 ——
  // dev 容器跑的也是 next build，但 e2e 依赖 testid 定位，所以默认不剥；
  // 真正发布给访客的 build 设 STRIP_TEST_HOOKS=1 触发 SWC compile-time strip。
  // 这是 dual-build：dev/CI 留 hook、prod release 干净 HTML。
  compiler: process.env['STRIP_TEST_HOOKS'] === '1' ? {
    reactRemoveProperties: { properties: ['^data-testid$'] },
  } : undefined,
  // rewrites: /p/:slug 反代到 backend microsite asset handler。
  // v1 单 owner instance —— URL 不带 handle。放 beforeFiles 让 Next dynamic
  // route 不抢匹配，避免 trailingSlash redirect 死循环。
  rewrites: () => Promise.resolve({
    beforeFiles: [
      {
        source: '/p/:slug',
        destination: `${BACKEND_URL}/api/v1/microsites/:slug`,
      },
      {
        source: '/p/:slug/:path*',
        destination: `${BACKEND_URL}/api/v1/microsites/:slug/:path*`,
      },
      // owner MCP endpoint (Claude/Cursor → standmeet-mcp bridge POSTs here).
      // Not under /api, and must beat the dynamic [handle] owner-page route —
      // hence beforeFiles (same reason as /p/:slug). Without this it's
      // unreachable behind the prod app and owners can't connect over MCP.
      { source: '/mcp', destination: `${BACKEND_URL}/mcp` },
      { source: '/mcp/:path*', destination: `${BACKEND_URL}/mcp/:path*` },
      // The homepage-as-microsite (served at `/` by middleware) emits `<base href="/">`, so its
      // Vite bundle's `./assets/x` resolves to `/assets/x`. Those assets live under the homepage's
      // build dir on the backend — proxy them there. beforeFiles so this beats any app route; the
      // app itself serves nothing at /assets (its own static is /_next), so there's no collision.
      { source: '/assets/:path*', destination: `${BACKEND_URL}/api/v1/homepage/assets/:path*` },
    ],
    afterFiles: [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      { source: '/internal/:path*', destination: `${BACKEND_URL}/internal/:path*` },
      { source: '/robots.txt', destination: `${BACKEND_URL}/robots.txt` },
      { source: '/sitemap.xml', destination: `${BACKEND_URL}/sitemap.xml` },
    ],
    fallback: [],
  }),

  // headers: /embed.js 要能被**任意站点**跨源加载 —— 这是它存在的全部理由
  // （CLAUDE.md 承诺的"单个 <script> 标签 drop-in"）。后端的 /api/v1/* 早就有
  // PublicCORS 了，而这个文件是 Next 从 public/ 直接发的静态资源，走不到那条中间件，
  // 所以头得在这里加。少了它，脚本在第三方页面上取不到，而 embed 一行代码都跑不了。
  headers: () => Promise.resolve([
    {
      source: '/embed.js',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        // 版本跟着实例走，别让别人的站点抱着一份过期的挂半年。
        { key: 'Cache-Control', value: 'public, max-age=300' },
      ],
    },
    {
      // 访问码坐在 URL 的 query 里（简历 QR = `/<handle>?code=ABC`）。入口 hook 会立刻
      // history.replaceState 把它抹掉（use-absorb-code.ts），但首屏那一瞬 JS 还没跑，
      // 跨源子资源请求会把含码的完整 URL 放进 Referer 头。strict-origin-when-cross-origin：
      // 同源照常发完整 URL，跨源只发 origin（不含 query）——码从此不会随 Referer 出门
      // （pentest 2026-09-01；embed.js 那条不受影响，它上面单独放行 CORS）。
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ]),

  // 相对 asset 路径在 /p/<slug> 无尾杠时会断（resolve 到 /p/assets/...）。
  // backend serveAsset 在返回 index.html 时注入 <base href="/p/<slug>/">，
  // 避免 Next 端做 redirect 死循环（default trailingSlash=false 跟我们的
  // 加杠 redirect 会撞）。
};

// next-intl —— 指到 src/i18n/request.ts（**没有** locale 路由分段：只有一种语言，
// 分段是给"选语言"用的，而选语言还不存在）。将来多语言改的是那个文件，不是这里，也不是组件。
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
