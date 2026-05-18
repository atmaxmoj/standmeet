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
  // rewrites 用 object 形式：custom-page 必须放 beforeFiles，否则 Next 会
  // 先匹配 dynamic route `/[handle]/page.tsx`，规范化路径时加了尾杠又拿
  // 不到 page，于是来回 308（之前观察到 ERR_TOO_MANY_REDIRECTS）。
  rewrites: () => Promise.resolve({
    beforeFiles: [
      {
        source: '/:handle/p/:slug',
        destination: `${BACKEND_URL}/api/v1/custom-pages/:handle/:slug`,
      },
      {
        source: '/:handle/p/:slug/:path*',
        destination: `${BACKEND_URL}/api/v1/custom-pages/:handle/:slug/:path*`,
      },
    ],
    afterFiles: [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      { source: '/internal/:path*', destination: `${BACKEND_URL}/internal/:path*` },
      { source: '/robots.txt', destination: `${BACKEND_URL}/robots.txt` },
      { source: '/sitemap.xml', destination: `${BACKEND_URL}/sitemap.xml` },
    ],
    fallback: [],
  }),

  // 相对 asset 路径在 /<handle>/p/<slug> 无尾杠时会断（resolve 到
  // /<handle>/p/assets/...）。backend serveAsset 在返回 index.html 时
  // 注入 <base href="/<handle>/p/<slug>/">，避免 Next 端做 redirect 死循环
  // （default trailingSlash=false 跟我们的加杠 redirect 会撞）。
};

export default nextConfig;
