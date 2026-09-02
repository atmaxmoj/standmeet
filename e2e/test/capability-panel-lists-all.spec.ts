// capability-panel-lists-all.spec.ts -- Phase H / P.5: the capability panel lists **all**
// capabilities + connectors + skills, each row surfacing an origin badge (builtin/managed/
// owner). Locks that ListByOrigin reaches the frontend, and that all three kinds sit in
// one table.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { listCapabilities } from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-list@example.com', password: 'correct-horse-battery-staple',
  handle: 'caplist', fullName: 'Cap List Owner',
};

let csrf = '';
let admin: APIRequestContext;

test.describe('Phase H · capability panel lists all kinds with origin badge (P.5)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    const request = admin;
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    // owner-authored skill → an owner-origin skill row.
    const token = await createAPIToken(request, csrf, 'cap-list-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'skill_create', {
      name: 'owner-skill', description: 'an owner skill', prompt: 'do the thing',
    });
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('panel includes a builtin capability, a connector, and an owner skill — each with origin',
    async () => {
      const request = admin;
      const rows = await listCapabilities(request, csrf);

      // builtin capability (corpus.retrieval ships with the product).
      const builtin = rows.find((c) => c.id === 'corpus.retrieval');
      expect(builtin, 'builtin capability listed').toBeDefined();
      expect(builtin?.kind).toBe('capability');
      expect(builtin?.origin).toBe('builtin');

      // a connector row (google calendar) — kind connector.
      const connector = rows.find((c) => c.kind === 'connector');
      expect(connector, 'a connector listed').toBeDefined();

      // an owner-authored skill — kind skill, origin owner.
      const skill = rows.find((c) => c.kind === 'skill' && c.origin === 'owner');
      expect(skill, 'owner skill listed').toBeDefined();

      // every row carries one of the three origins.
      for (const r of rows) {
        expect(['builtin', 'managed', 'owner'], `origin on ${r.id}`).toContain(r.origin);
      }
    });
});
