// capability-list-by-origin.spec.ts -- Phase H / P.5: ListByOrigin (migration count).
// Built-in capabilities all carry origin=builtin; the panel can filter by origin. This test
// locks in "the known built-in set is entirely builtin origin" -- during the migration,
// ListByOrigin(builtin) counts how many are still left to migrate out.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { listCapabilities } from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-origin@example.com', password: 'correct-horse-battery-staple',
  handle: 'caporigin', fullName: 'Cap Origin Owner',
};

// Built-in capabilities currently shipped with the product (this set shrinks as they migrate out).
const KNOWN_BUILTINS = [
  'corpus.retrieval', 'calendar.book', 'skill.runner', 'ext.mcp',
  'ask_visitor', 'summarize_conversation',
];

let csrf = '';
let admin: APIRequestContext;

test.describe('Phase H · ListByOrigin (P.5 migration counter)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    admin = await playwright.request.newContext();
    const request = admin;
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
  });

  test.afterAll(async () => { await admin?.dispose(); });

  test('known builtin capabilities all report origin=builtin',
    async () => {
      const request = admin;
      const rows = await listCapabilities(request, csrf);
      const builtinIDs = rows.filter((c) => c.origin === 'builtin').map((c) => c.id);

      // migration counter: there is a non-empty builtin set today.
      expect(builtinIDs.length, 'builtins exist').toBeGreaterThan(0);
      // each known builtin is present and tagged builtin.
      for (const id of KNOWN_BUILTINS) {
        const row = rows.find((c) => c.id === id);
        expect(row, `${id} listed`).toBeDefined();
        expect(row?.origin, `${id} origin`).toBe('builtin');
      }
    });
});
