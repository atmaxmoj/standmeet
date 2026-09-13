// block-install-cycle-refused.spec.ts — everything-is-a-block: a cyclic composition is refused.
//
// A block depends on another when it `requires` a seam that one `provides`. That graph must be a
// DAG — a cycle (A needs B, B needs A) has no load order, so installing the block that would close
// the loop is refused, and the block is neither persisted nor mounted (everything-is-a-block.md,
// "a cyclic composition is refused ... the composition is not mounted").
//
// Black-box: install A (provides seam-a, requires seam-b) — fine, no cycle yet. Then install B
// (provides seam-b, requires seam-a) — that closes A↔B, so the install is rejected with a message
// naming the cycle, and B does not appear in the block list.
//
// RED before the check: B installed (201) and the loop stood. GREEN: B is refused (4xx).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { listBlocks } from '@/fixtures/blocks';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'cycle@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cycleowner',
  fullName: 'Cycle Owner',
};

function manifest(id: string, provides: string, requires: string): string {
  return [
    `id: ${id}`,
    `title: ${id}`,
    'version: "1"',
    `provides: ${provides}`,
    'requires:',
    `  - ${requires}`,
  ].join('\n');
}

const A = manifest('cyclea', 'seam-ca', 'seam-cb');
const B = manifest('cycleb', 'seam-cb', 'seam-ca'); // closes the loop with A

async function install(request: APIRequestContext, csrf: string, m: string) {
  // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: block install
  return request.post(`${BACKEND}/api/admin/blocks`, {
    headers: { 'X-Csrftoken': csrf }, data: { manifest: m },
  });
}

test.describe('installing a block that would form a dependency cycle is refused', () => {
  test('install A ok; install B (closes A↔B) refused, and B is not installed',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      resetInstance();
      await claim(request, findSetupToken(), {
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, fullName: OWNER.fullName,
      });
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      const aRes = await install(request, csrf, A);
      expect(aRes.status(), await aRes.text()).toBe(201);

      const bRes = await install(request, csrf, B);
      expect(bRes.status(), 'cyclic install is refused').toBe(400);
      expect(await bRes.text(), 'the refusal names the cycle').toMatch(/cycle/i);

      // B was not persisted: refuse-before-install means it never reaches the block list.
      const ids = (await listBlocks(request, csrf)).map((b) => b.id);
      expect(ids, 'A installed').toContain('cyclea');
      expect(ids, 'B not installed').not.toContain('cycleb');

      await request.dispose();
    });
});
