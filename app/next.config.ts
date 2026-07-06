import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
  // node-tikzjax(/render-tikz 用):(1) 保持 external 不被 Next 打进 route bundle —— 否则
  // __dirname 变、它读的 ../tex/*.gz 找不着;(2) 显式 trace-include 那 3 个运行时 TeX 资产
  // (core.dump.gz / tex.wasm.gz / tex_files.tar.gz 是 fs.read 的,不走 import,tracing 抓不到)。
  serverExternalPackages: ['node-tikzjax'],
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
  // rewrites: /p/:slug 反代到 backend custom-page asset handler。
  // v1 单 owner instance —— URL 不带 handle。放 beforeFiles 让 Next dynamic
  // route 不抢匹配，避免 trailingSlash redirect 死循环。
  rewrites: () => Promise.resolve({
    beforeFiles: [
      {
        source: '/p/:slug',
        destination: `${BACKEND_URL}/api/v1/custom-pages/:slug`,
      },
      {
        source: '/p/:slug/:path*',
        destination: `${BACKEND_URL}/api/v1/custom-pages/:slug/:path*`,
      },
      // owner MCP endpoint (Claude/Cursor → standmeet-mcp bridge POSTs here).
      // Not under /api, and must beat the dynamic [handle] owner-page route —
      // hence beforeFiles (same reason as /p/:slug). Without this it's
      // unreachable behind the prod app and owners can't connect over MCP.
      { source: '/mcp', destination: `${BACKEND_URL}/mcp` },
      { source: '/mcp/:path*', destination: `${BACKEND_URL}/mcp/:path*` },
    ],
    afterFiles: [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      { source: '/internal/:path*', destination: `${BACKEND_URL}/internal/:path*` },
      { source: '/robots.txt', destination: `${BACKEND_URL}/robots.txt` },
      { source: '/sitemap.xml', destination: `${BACKEND_URL}/sitemap.xml` },
    ],
    fallback: [],
  }),

  // 相对 asset 路径在 /p/<slug> 无尾杠时会断（resolve 到 /p/assets/...）。
  // backend serveAsset 在返回 index.html 时注入 <base href="/p/<slug>/">，
  // 避免 Next 端做 redirect 死循环（default trailingSlash=false 跟我们的
  // 加杠 redirect 会撞）。
};

export default nextConfig;
