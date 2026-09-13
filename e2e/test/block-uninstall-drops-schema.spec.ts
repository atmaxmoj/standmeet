// block-uninstall-drops-schema.spec.ts — everything-is-a-block S2, item 8.
//
// A block that keeps state gets its own Postgres schema (mcp_<id>) provisioned at
// install. Uninstall must DROP that schema — otherwise every install/uninstall cycle
// leaves an orphan schema behind (the measured `mcp_acme_widget_zzfixture` leak).
//
// Black-box, real DB: the owner installs a storing block over the real admin REST
// (POST /api/admin/blocks), we confirm the schema exists (guards against a vacuous
// green — if install never provisioned it, the absence check below could not fail),
// then delete the block (DELETE /api/admin/blocks/{id}) and assert the schema is gone.
//
// RED before the fix: blockOps.Delete → assembly.Uninstall deleted only the
// installed_blocks row and left the schema. GREEN once Delete also runs
// blockstore.Store.Drop (Dispose = Drop), recomputing the schema from the block id.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { deleteBlock } from '@/fixtures/blocks';
import { resetInstance, findSetupToken, querySQL } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'schema-leak@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'schemaleak',
  fullName: 'Schema Leak Owner',
};

// A data-only storing block: a `config` field is enough to make needsStorage true, so
// installing it provisions a schema. It declares no transport, which ParseManifest
// accepts (a block that only carries settings is legitimate) and mount tolerates.
const BLOCK_ID = 'schemaleak-fixture';
// mcp_<sanitized-id>: lowercase, [^a-z0-9]+ → _.
const SCHEMA = 'mcp_schemaleak_fixture';
const MANIFEST = [
  `id: ${BLOCK_ID}`,
  'title: Schema Leak Fixture',
  'version: "1"',
  'provides: schemaleak',
  'config:',
  '  - key: greeting',
  '    label: Greeting',
  '    type: string',
  '    default: hello',
].join('\n');

function schemaExists(name: string): boolean {
  const out = querySQL(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${name}'`,
  );
  return out === '1';
}

test.describe('block uninstall drops its schema (no orphan leak)', () => {
  test('install a storing block → schema exists; delete it → schema gone',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      await setup(request);
      const { csrf } = await login(request, OWNER.email, OWNER.password);

      // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: install provisions the schema
      const installRes = await request.post(`${BACKEND}/api/admin/blocks`, {
        headers: { 'X-Csrftoken': csrf },
        data: { manifest: MANIFEST },
      });
      expect(installRes.status(), await installRes.text()).toBe(201);

      // The schema is really there — so the absence assertion below is meaningful.
      expect(schemaExists(SCHEMA), `schema ${SCHEMA} provisioned at install`).toBe(true);

      const status = await deleteBlock(request, csrf, BLOCK_ID);
      expect(status).toBe(200);

      // The leak: without the Drop, the schema survives the uninstall.
      expect(schemaExists(SCHEMA), `schema ${SCHEMA} dropped at uninstall`).toBe(false);
      await request.dispose();
    });
});

async function setup(request: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
}
