// capability-enable-disable-concurrency.spec.ts —— Phase H corner：enable/disable
// 并发不串。owner 在两个 tab 狂点开关 → 后端 upsert 不该死锁/500/留半行；最终
// 状态确定、一致。capability_settings 是 (owner_id, capability_id) upsert，并发
// 写要安全。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability, setCapabilityEnabled } from '@/fixtures/capabilities';

const OWNER = {
  email: 'cap-conc@example.com', password: 'correct-horse-battery-staple',
  handle: 'capconc', fullName: 'Cap Conc Owner',
};

const CAP_ID = 'corpus.retrieval';

let csrf = '';

test.describe('Phase H · enable/disable under concurrency', () => {
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

  test('many concurrent toggles → all 200, no corruption, deterministic final state',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // fire 12 interleaved enable/disable concurrently.
      const calls = Array.from({ length: 12 }, (_, i) =>
        setCapabilityEnabled(request, csrf, CAP_ID, i % 2 === 0));
      const statuses = await Promise.all(calls);
      // upsert must be concurrency-safe: every write succeeds, none 500/deadlock.
      for (const s of statuses) expect(s, 'no error under concurrency').toBe(200);

      // a final explicit write wins and the row is in a consistent, readable state.
      expect(await setCapabilityEnabled(request, csrf, CAP_ID, false)).toBe(200);
      expect((await findCapability(request, csrf, CAP_ID))?.enabled).toBe(false);
      expect(await setCapabilityEnabled(request, csrf, CAP_ID, true)).toBe(200);
      expect((await findCapability(request, csrf, CAP_ID))?.enabled).toBe(true);

      await request.dispose();
    });
});
