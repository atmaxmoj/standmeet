import { fileURLToPath } from 'node:url';
import path from 'node:path';

import type { NextConfig } from 'next';

// rewrites/proxies /api/* 到 backend，避免在浏览器配 CORS（dev + docker
// 同样的 rewrite 让 SSR 和客户端 fetch 用同一个相对路径）。
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://backend:8000';

// import.meta.url 在 ESM ts 里走得通；用它解出 app/ 绝对路径锁 trace root，
// 不然 next 会把上层 monorepo 目录当 root，standalone bundle 路径变怪
// (.next/standalone/Develop/projects/.../server.js 而不是 .next/standalone/server.js)。
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: APP_DIR,
  rewrites: () => Promise.resolve([
    { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
    { source: '/internal/:path*', destination: `${BACKEND_URL}/internal/:path*` },
  ]),
};

export default nextConfig;
