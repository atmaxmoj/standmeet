// uninstall-data-loss-warning.spec.ts — everything-is-a-block S2 item 9.
//
// Item 8 drops the schema on uninstall (no orphan). But dropping a block that HELD data is
// permanent, so the owner must not lose it silently: uninstall-with-data raises a persistent
// data-loss warning, surfaced in admin (everything-is-a-block.md rule 3 — "warns of data loss,
// and the warning is a block too").
//
// Black-box, anchored: install a storing block, put a record in it (a saved config value lands in
// the block's own storage), confirm no warning stands yet, delete the block, then assert a
// data_loss warning naming the block appears at GET /api/admin/warnings. The "no warning before"
// check makes the "warning after" a real state change, not a pre-existing row.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { deleteBlock } from '@/fixtures/blocks';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'data-loss@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dataloss',
  fullName: 'Data Loss Owner',
};

const BLOCK_ID = 'dataloss-int-fixture';
const MANIFEST = [
  `id: ${BLOCK_ID}`,
  'title: Data Loss Fixture',
  'version: "1"',
  'provides: dataloss',
  'config:',
  '  - key: bump',
  '    label: Bump',
  '    type: int',
].join('\n');

interface Warning { kind: string; block_id: string; message: string; at: string }

async function warnings(request: APIRequestContext, csrf: string): Promise<Warning[]> {
  const res = await request.get(`${BACKEND}/api/admin/warnings`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { warnings: Warning[] }).warnings;
}

test.describe('uninstalling a block that held data raises a data-loss warning', () => {
  test('install storing block → put a record → delete → warning appears in admin',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      resetInstance();
      await claim(request, findSetupToken(), {
        email: OWNER.email, password: OWNER.password,
        handle: OWNER.handle, fullName: OWNER.fullName,
      });
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: install
      const installRes = await request.post(`${BACKEND}/api/admin/blocks`, {
        headers: { 'X-Csrftoken': csrf }, data: { manifest: MANIFEST },
      });
      expect(installRes.status(), await installRes.text()).toBe(201);

      // Put a record in the block's own storage: a saved config value lands there.
      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: writing block data
      const cfgRes = await request.patch(`${BACKEND}/api/admin/blocks/${BLOCK_ID}/config`, {
        headers: { 'X-Csrftoken': csrf }, data: { values: { bump: 7 } },
      });
      expect(cfgRes.status(), await cfgRes.text()).toBe(200);

      // Anchor: no data-loss warning for this block yet.
      const before = await warnings(request, csrf);
      expect(before.some((w) => w.block_id === BLOCK_ID), 'no warning before delete').toBe(false);

      expect(await deleteBlock(request, csrf, BLOCK_ID)).toBe(200);

      // The dropped data is now reported by a standing warning.
      const after = await warnings(request, csrf);
      const w = after.find((x) => x.block_id === BLOCK_ID && x.kind === 'data_loss');
      expect(w, 'data-loss warning present after deleting a block that held data').toBeTruthy();
      expect(w!.message, 'warning names how much was dropped').toMatch(/dropped \d+ stored record/);

      await request.dispose();
    });
});
