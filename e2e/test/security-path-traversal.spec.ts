// security-path-traversal.spec.ts —— pentest。owner-built custom page 的静态资源经
// GET /api/v1/custom-pages/{slug}/{*path} 读盘;必须把 `../` / 编码穿越 / 绝对路径挡在
// build 根目录内(joinSafeAssetPath),不能读到宿主机文件。绿=穿越被挡;红=任意读盘。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// 各种穿越 payload:相对、编码、双编码、绝对、混合。
const TRAVERSALS = [
  '../../../../etc/passwd',
  '..%2f..%2f..%2f..%2fetc%2fpasswd',
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '....//....//....//etc/passwd',
  '/etc/passwd',
];

async function fetchAsset(
  request: APIRequestContext, slug: string, path: string,
): Promise<{ status: number; body: string }> {
  const res = await request.get(`${BACKEND}/api/v1/custom-pages/${slug}/${path}`);
  return { status: res.status(), body: await res.text() };
}

test.describe('pentest · custom-page asset path traversal', () => {
  test('encoded / relative / absolute traversal never reaches host files',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      for (const payload of TRAVERSALS) {
        const { status, body } = await fetchAsset(request, 'anypage', payload);
        // 绝不返回宿主机敏感文件内容。
        expect(body, `no /etc/passwd content for: ${payload}`).not.toMatch(/root:.*:0:0:/);
        expect(body, `no shadow/host markers for: ${payload}`).not.toMatch(/\/bin\/(ba)?sh\b/);
        // 且不是 2xx 泄漏——穿越应被挡(4xx)或落回 build 根内不存在(404)。
        expect(status, `traversal must not 2xx: ${payload}`).toBeGreaterThanOrEqual(400);
      }
      await request.dispose();
    });
});
