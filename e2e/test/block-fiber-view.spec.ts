// block-fiber-view.spec.ts — the plugins group's fiber view draws the block dependency graph.
//
// GUI: install a provider block and a consumer that requires it, open the Plugins > fibers section,
// and confirm the mermaid dependency graph renders with both blocks on it (the composition drawn).
// The graph's edges are the relied-by relationship the fiber view exists to show. A screenshot is
// saved for design review (the /goal's "screenshot-verify new UI/UX").

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'fiber-view@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'fiberview',
  fullName: 'Fiber View Owner',
};

function manifest(id: string, provides: string, requires?: string): string {
  const lines = [`id: ${id}`, `title: ${id}`, 'version: "1"', `provides: ${provides}`];
  if (requires) lines.push('requires:', `  - ${requires}`);
  return lines.join('\n');
}

async function install(request: APIRequestContext, csrf: string, m: string): Promise<void> {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- fixture setup: install blocks to graph
  const res = await request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: m },
  });
  expect(res.status(), await res.text()).toBe(201);
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('fiber view draws the block dependency graph', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await install(request, csrf, manifest('fvdb', 'fvdb'));
    await install(request, csrf, manifest('fvuser', 'fvapp', 'fvdb'));
    await request.dispose();
  });

  test('the Plugins > block map section renders the dependency graph', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'blockMap');
    await adminPage.waitForURL('**/admin/blockMap', { timeout: 5_000 });

    // The graph container renders, and mermaid draws an SVG inside it.
    const graph = adminPage.getByTestId('block-map-graph');
    await expect(graph).toBeVisible({ timeout: 10_000 });
    await expect(graph.locator('svg')).toBeVisible({ timeout: 10_000 });
    // Both blocks appear as nodes on the graph (labels are the block ids).
    await expect(graph).toContainText('fvdb', { timeout: 10_000 });
    await expect(graph).toContainText('fvuser');

    await adminPage.screenshot({ path: 'test-results/fiber-view.png', fullPage: true });
  });
});
