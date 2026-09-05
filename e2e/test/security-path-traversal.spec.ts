// security-path-traversal.spec.ts — pentest. An owner-built custom page's static assets
// are read from disk via GET /api/v1/microsites/{slug}/{*path}; `../` / encoded
// traversal / absolute paths must be confined inside the build root
// (joinSafeAssetPath), never reaching host files. Green = traversal is blocked; red =
// arbitrary file read.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// Various traversal payloads: relative, encoded, double-encoded, absolute, mixed.
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
  const res = await request.get(`${BACKEND}/api/v1/microsites/${slug}/${path}`);
  return { status: res.status(), body: await res.text() };
}

test.describe('pentest · microsite asset path traversal', () => {
  test('encoded / relative / absolute traversal never reaches host files',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      for (const payload of TRAVERSALS) {
        const { status, body } = await fetchAsset(request, 'anypage', payload);
        // Must never return the content of sensitive host files.
        expect(body, `no /etc/passwd content for: ${payload}`).not.toMatch(/root:.*:0:0:/);
        expect(body, `no shadow/host markers for: ${payload}`).not.toMatch(/\/bin\/(ba)?sh\b/);
        // And no 2xx leak either — traversal should be blocked (4xx) or land on a
        // nonexistent path inside the build root (404).
        expect(status, `traversal must not 2xx: ${payload}`).toBeGreaterThanOrEqual(400);
      }
      await request.dispose();
    });
});
