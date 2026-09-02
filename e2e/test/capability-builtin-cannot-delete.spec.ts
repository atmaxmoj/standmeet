// capability-builtin-cannot-delete.spec.ts — Phase H / P.6: existence is decided by Origin. The
// delete button **only lights up for owner-origin** — builtin/managed capabilities cannot be
// deleted (though they can be disabled, see capability-enable-disable). owner-origin capabilities
// (a skill the owner authored themselves / an MCP server they registered) get a full delete path.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import {
  listCapabilities, findCapability, deleteCapability,
} from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-del@example.com', password: 'correct-horse-battery-staple',
  handle: 'capdel', fullName: 'Cap Del Owner',
};

const BUILTIN_ID = 'corpus.retrieval';

let csrf = '';
let admin: APIRequestContext;

test.describe('Phase H · existence is Origin-controlled (delete only owner-origin)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    const request = admin;
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    // owner-authored skill → an owner-origin entry that IS deletable.
    const token = await createAPIToken(request, csrf, 'cap-del-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'skill_create', {
      name: 'owner-thing', description: 'an owner-origin capability',
      prompt: 'owner instructions',
    });
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('builtin corpus.retrieval → deletable:false AND DELETE is rejected',
    async () => {
      const request = admin;
      const cap = await findCapability(request, csrf, BUILTIN_ID);
      expect(cap?.origin).toBe('builtin');
      expect(cap?.deletable, 'builtin not deletable').toBe(false);
      // hard guard: even a direct DELETE must be refused (>=400), not silently no-op.
      expect(await deleteCapability(request, csrf, BUILTIN_ID)).toBeGreaterThanOrEqual(400);
    });

  test('owner-origin entry → deletable:true AND DELETE removes it',
    async () => {
      const request = admin;
      // find the owner-origin row by its origin (don't hardcode the id scheme).
      const ownerRow = (await listCapabilities(request, csrf)).find((c) => c.origin === 'owner');
      expect(ownerRow, 'an owner-origin capability exists').toBeDefined();
      expect(ownerRow?.deletable, 'owner-origin deletable').toBe(true);

      const status = await deleteCapability(request, csrf, ownerRow!.id);
      expect(status, 'delete succeeds').toBeGreaterThanOrEqual(200);
      expect(status).toBeLessThan(300);

      // gone from the list.
      expect((await listCapabilities(request, csrf)).some((c) => c.id === ownerRow!.id))
        .toBe(false);
    });
});
