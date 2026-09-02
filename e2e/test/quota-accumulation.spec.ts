// quota-accumulation.spec.ts —— when max_members=N: N distinct names can all get in,
// the (N+1)th distinct name is refused; an existing name coming back doesn't consume a
// slot (resuming).
//
// User story:
//   "5 rounds of interviews" = 5 different people (not one person across 5 segments).
// max_members=N is for N people; only the (N+1)th new name gets refused; anyone
// already on the list gets back in as usual.

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

const CODE = 'INTERVIEW-A3';
const MAX_MEMBERS = 3;
const NAMES = ['Sarah', 'Bob', 'Carol'];

test.describe('max_members admits N distinct names, blocks the (N+1)th', () => {
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

  test('N distinct names OK, (N+1)th blocked, existing name still resumes',
    async ({ request }) => {
      // N distinct names can all get in.
      for (const name of NAMES) {
        const s = await issueSession(request, {
          handle: OWNER.handle, code: CODE, visitor_name: name,
        });
        expect(s.session_token).not.toBe('');
      }

      // The (N+1)th **new** name → full, 403.
      const overflow = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Dave',
      });
      expect(overflow).toBe(403);

      // Someone already on the list (Sarah) comes back → resumes, still 200 (doesn't
      // consume a new slot).
      const returning = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Sarah',
      });
      expect(returning).toBe(200);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round A — 3 people',
    purpose: 'quota-accumulation spec',
    max_members: MAX_MEMBERS,
  });
}
