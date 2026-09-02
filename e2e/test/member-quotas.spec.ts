// member-quotas.spec.ts —— max_members: the cap on how many distinct names (people) a code allows.
//
// User story:
//   The owner issues INTERVIEW-A1 (max_members=1) — meant for one person only. Sarah enters
//   with her name, ok; she enters again with the same name, still ok (same name = same
//   person, resumes her session). Bob enters with the same code but a **different name** →
//   rejected (the seat is taken; only 1 name is allowed).
//
// Runs entirely through the API (visitor-side helpers); the UI flow is verified in max-members.spec.ts.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-A1';

test.describe('max_members caps the number of distinct names on a code', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithMaxMembers(request);
    await request.dispose();
  });

  test('same name always allowed (resumes); a different name is blocked when full',
    async ({ request }) => {
      // Sarah (name #1) → ok.
      const first = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(first.session_token).not.toBe('');

      // Sarah again = the same person, resuming → still ok (doesn't take a new seat).
      const sarahAgain = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(sarahAgain).toBe(200);

      // Bob = name #2; max_members=1 is already full → 403.
      const bob = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Bob',
      });
      expect(bob).toBe(403);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A',
    purpose: 'member-quota spec',
    max_members: 1,
  });
}
