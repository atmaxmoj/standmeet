// turn-quota.spec.ts — a code with max_turns_per_session=2 set: after the visitor sends 2
// messages, the 3rd chat message gets 403 turn_quota_reached.
//
// User story:
//   An interviewer wants to cap each interview round at 2 turns. Once the code's quota
//   takes effect, the visitor's 3rd POST /messages gets no reply — this must not fail
//   silently as a stream error; it needs to be a clear 403 with an error code, so the
//   frontend can trigger a toast.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'INTERVIEW-T2';
const MAX_TURNS = 2;

test.describe('per-session turn quota stops chat after N turns', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await issueCodeWithTurnLimit(request);
    await request.dispose();
  });

  test('first 2 messages 200, 3rd 403 turn_quota_reached', async ({ request }) => {
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'Eve',
    });
    for (let i = 0; i < MAX_TURNS; i++) {
      const res = await sendMessage(request, sess, `turn ${i + 1}`);
      expect(res.status()).toBe(200);
      // SSE response — drain it to avoid a dangling socket
      await res.body();
    }
    const blocked = await sendMessage(request, sess, 'turn 3 — over quota');
    expect(blocked.status()).toBe(403);
    const body = await blocked.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('turn_quota_reached');
  });
});

async function issueCodeWithTurnLimit(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createAPIToken(request, csrf, 'noop-token');
  await createCode(request, csrf, {
    code: CODE,
    label: 'Interview round T — 2 turns max',
    purpose: 'turn-quota spec',

    max_turns_per_session: MAX_TURNS,
  });
}
