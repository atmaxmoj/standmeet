// anonymous-member-id.spec.ts — anonymous visitors each get a distinct member (with their own
// id), and resume via member_id; they no longer collapse into one shared member.
//
// User story:
//   Two people both skip the name field into the same code → each gets a distinct guest member
//   (different member_id / different conversation). One of them keeps their member_id and comes
//   back → resumes that same session. Each member_id also counts against one max_members slot.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, issueSessionStatus } from '@/fixtures/visitor';

const OWNER = {
  email: 'anon-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'anonowner',
  fullName: 'Anon Owner',
};

const CODE = 'ANON-3';
const ANON_CAP = 'ANON-CAP-2'; // max_members=2, filled purely by anonymous visitors

test.describe('anonymous visitors are distinct members via member_id', () => {
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

  test('two anon sessions = distinct members; member_id resumes; counts toward max',
    async ({ request }) => {
      // Two anonymous sessions (no name, no member_id) → two distinct members + distinct
      // conversations.
      const a = await issueSession(request, { handle: OWNER.handle, code: CODE });
      const b = await issueSession(request, { handle: OWNER.handle, code: CODE });
      expect(a.member_id).toBeTruthy();
      expect(b.member_id).toBeTruthy();
      expect(a.member_id).not.toBe(b.member_id);
      expect(a.conversation_id).not.toBe(b.conversation_id);

      // Resuming with a's member_id → the same member + the same conversation.
      const aAgain = await issueSession(request, {
        handle: OWNER.handle, code: CODE, member_id: a.member_id,
      });
      expect(aAgain.member_id).toBe(a.member_id);
      expect(aAgain.conversation_id).toBe(a.conversation_id);

      // Already 2 anonymous members (max_members=3): a 3rd with a new name still fits, a 4th is
      // full.
      const named = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Carol',
      });
      expect(named.member_id).toBeTruthy();
      const overflow = await issueSessionStatus(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Dave',
      });
      expect(overflow).toBe(403);
    });

  // Pure anonymous can also hit the wall: a code with max_members=2, two skips fill it, a 3rd
  // anonymous visitor → 403. This goes through checkAnonQuota (a different function from the
  // named checkMemberQuota), pinning down its refusal branch specifically.
  test('anonymous-only fills the cap; a further anon visitor is blocked',
    async ({ request }) => {
      const a = await issueSession(request, { handle: OWNER.handle, code: ANON_CAP });
      const b = await issueSession(request, { handle: OWNER.handle, code: ANON_CAP });
      expect(a.member_id).not.toBe(b.member_id); // each takes one slot, 2/2 full.

      const third = await issueSessionStatus(request, {
        handle: OWNER.handle, code: ANON_CAP,
      });
      expect(third).toBe(403);

      // Resuming doesn't take a new slot: coming back with a's member_id gets in even while full.
      const resume = await issueSession(request, {
        handle: OWNER.handle, code: ANON_CAP, member_id: a.member_id,
      });
      expect(resume.member_id).toBe(a.member_id);
    });
});

async function issueCodeWithMaxMembers(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'anon-seed');
  await createCode(request, csrf, {
    code: CODE, label: 'Anon member-id test', max_members: 3,
  });
  await createCode(request, csrf, {
    code: ANON_CAP, label: 'Anon cap test', max_members: 2,
  });
}
