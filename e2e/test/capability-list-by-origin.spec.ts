// capability-list-by-origin.spec.ts —— Phase H / P.5：ListByOrigin（迁移计数）。
// 内建能力都带 origin=builtin；面板能按 origin 分。这条锁「已知内建集合全是
// builtin origin」—— 迁移期 ListByOrigin(builtin) 数出还剩几个没迁出去。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { listCapabilities } from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-origin@example.com', password: 'correct-horse-battery-staple',
  handle: 'caporigin', fullName: 'Cap Origin Owner',
};

// 当前随产品发的内建能力（迁出去后这个集合会缩小）。
const KNOWN_BUILTINS = [
  'corpus.retrieval', 'calendar.book', 'skill.runner', 'ext.mcp',
  'ask_visitor', 'summarize_conversation',
];

let csrf = '';

test.describe('Phase H · ListByOrigin (P.5 migration counter)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await request.dispose();
  });

  test('known builtin capabilities all report origin=builtin',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
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
      await request.dispose();
    });
});
