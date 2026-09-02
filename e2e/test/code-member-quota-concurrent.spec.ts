// code-member-quota-concurrent.spec.ts —— the member cap must hold under concurrency, or it's just a suggestion.
//
// What was seen in the real environment: `VERIFY-A01` showed `11 / 10 names` — 11
// members against a cap of 10. The visitor popup faithfully echoed "Up to 10
// people can use this code — 11 already in", and clicking START was refused. In
// other words, this code was stuck in a state that should never exist: full, and
// one over full besides.
//
// Root cause: the gate is **read-then-write**, nothing in between.
// checkMemberQuota / checkAnonQuota read from a separately-fetched members slice
// (visitor.go), while GetOrCreateMember / CreateAnonymousMember are bare
// inserts — no transaction, no row lock, and the database layer has no
// "member count ≤ max_members" constraint either. Two sessions open at once:
// both read len=9, both evaluate 9 >= 10 as false, both insert → 10 becomes 11.
//
// This case doesn't simulate concurrency, it IS concurrency: fire N named
// joins at once, then count what actually landed.

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { test, expect } from '@/fixtures/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'quotarace@example.com', password: 'correct-horse-battery-staple',
  handle: 'quotarace', fullName: 'Quota Race Owner',
};

const CODE = 'RACE-CAP1';
const CAP = 5;
// How many people rush in at once. Must clearly exceed the cap, otherwise a lucky serialization would let the case slip through.
const RUSH = 12;

test.describe('access-codes · the name cap holds under concurrency', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'race', max_members: CAP });
    await request.dispose();
  });

  test('twelve people entering at once cannot push the code past its cap',
    async ({ playwright }) => {
      // One independent request context per person — sharing one would serialize the calls, and then this wouldn't be testing concurrency at all.
      const guests = await Promise.all(
        Array.from({ length: RUSH }, () => playwright.request.newContext()),
      );

      // Fire them all at the same instant: build all the promises first, then await — don't wait for them one by one.
      const joins = guests.map((ctx, i) => ctx.post(`${BACKEND}/api/v1/sessions`, {
        data: { mode: 'code', code: CODE, visitor_name: `racer-${i}` },
      }));
      const results = await Promise.all(joins);
      const opened = results.filter((r) => r.status() === 200).length;

      const admin = await playwright.request.newContext();
      const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
      const codes = await (await admin.get(`${BACKEND}/api/admin/codes`, {
        headers: { 'X-Csrftoken': csrf },
      })).json() as { code: string; id: string }[];
      const row = codes.find((c) => c.code === CODE);
      const members = await (await admin.get(
        `${BACKEND}/api/admin/codes/${row?.id ?? ''}/members`,
        { headers: { 'X-Csrftoken': csrf } },
      )).json() as unknown[];

      // The criterion is **the member count actually persisted**, not how many
      // requests returned 200 — the latter is what the client sees, the former
      // is how much of the owner's quota actually got consumed.
      expect(
        members.length,
        `the code may never hold more than its cap; ${opened} sessions opened`,
      ).toBeLessThanOrEqual(CAP);

      await Promise.all([...guests, admin].map((c) => c.dispose()));
    });
});
