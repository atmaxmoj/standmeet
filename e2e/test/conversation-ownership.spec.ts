// conversation-ownership.spec.ts —— a session acts only on conversations it owns.
//
// Two doors take a conversation id from the caller:
//   • the direct tool route `POST /api/v1/sessions/{conversation_id}/tools/{tool}` — the id came
//     from the URL with no ownership check, so another visitor could run summarize_conversation
//     over someone else's transcript;
//   • `/api/v1/agent/turn` — it checked membership for code sessions, but a codeless (public /
//     BYOAI) session skipped the check, so it could write its turns into anyone's conversation.
// Contract: a foreign conversation id is refused the same way as one that does not exist, and
// nothing of the foreign conversation reaches the caller or the model; the owner's own transcript
// of that conversation is unchanged.
//
// Positive control in each case: the conversation's own session succeeds on the same door, so a
// green here cannot come from the door being shut for everyone.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { seedOwnerLoggedIn, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { createCode } from '@/fixtures/codes';
import {
  gatewayRequestExists, resetGatewayRequests, scriptMockReplyText,
} from '@/fixtures/mock-llm-script';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const ALICE_MARKER = 'ALICE-PRIVATE-7f3c layoff plans for Q3';
const INTRUDER_MARKER = 'INTRUDER-WROTE-THIS-91ab';

async function turn(
  request: APIRequestContext, sess: VisitorSession, convID: string, msg: string,
): Promise<{ status: number; body: string }> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { user_message: msg, conversation_id: convID },
  });
  return { status: res.status(), body: await res.text() };
}

async function toolCall(
  request: APIRequestContext, sess: VisitorSession, convID: string, tool: string,
): Promise<{ status: number; body: string }> {
  const res = await request.post(`${BACKEND}/api/v1/sessions/${convID}/tools/${tool}`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: {},
  });
  return { status: res.status(), body: await res.text() };
}

// ghostShown —— the SDK's "a ghost suggestion was shown" log call, as this session; the status.
async function ghostShown(
  request: APIRequestContext, sess: VisitorSession, convID: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions/${convID}/ghosts/shown`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { ghost_text: 'a planted ghost', source: 'initial', turn_index: 0 },
  });
  return res.status();
}

// ownerTranscript —— the conversation as the owner's admin reads it, one string to search.
async function ownerTranscript(seed: BaseSeed, convID: string): Promise<string> {
  const res = await seed.request.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': seed.csrf },
  });
  expect(res.status(), 'owner reads the conversation').toBe(200);
  return res.text();
}

test.describe('conversation ownership · a foreign conversation id reaches nothing', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });
  let seed: BaseSeed;
  let alice: VisitorSession;
  let bob: VisitorSession;
  let pub: VisitorSession;

  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
    const code = await createCode(seed.request, seed.csrf, {
      code: 'CONV-OWN1', label: 'convown', max_members: 5,
    });
    alice = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'Alice',
    });
    bob = await issueSession(seed.request, {
      handle: OWNER.handle, mode: 'code', code: code.code, visitor_name: 'Bob',
    });
    pub = await issueSession(seed.request, { handle: OWNER.handle, mode: 'public', visitor_name: 'Anon' });
    // Alice's conversation carries a marker the model saw and the transcript holds.
    const tag = await scriptMockReplyText(seed.request, 'Noted.');
    const own = await turn(seed.request, alice, alice.conversation_id, `${ALICE_MARKER}${tag}`);
    expect(own.status, 'Alice talks in her own conversation').toBe(200);
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the tool route refuses another member\'s conversation id (summarize reads nothing)',
    async () => {
      await resetGatewayRequests(seed.request);
      const bola = await toolCall(seed.request, bob, alice.conversation_id, 'summarize_conversation');
      expect(bola.status, `Bob is refused on Alice's conversation: ${bola.body}`).toBeGreaterThanOrEqual(400);
      expect(bola.body, 'nothing of Alice reaches Bob').not.toContain('ALICE-PRIVATE');
      expect(await gatewayRequestExists(seed.request, 'ALICE-PRIVATE'),
        'Alice\'s transcript never reached the model on Bob\'s call').toBe(false);

      // Positive control: Alice summarizing her own conversation on the same door goes through.
      const ownSum = await toolCall(seed.request, alice, alice.conversation_id, 'summarize_conversation');
      expect(ownSum.status, `Alice summarizes her own: ${ownSum.body.slice(0, 200)}`).toBe(200);
    });

  test('the tool route refuses a public session naming a code member\'s conversation', async () => {
    await resetGatewayRequests(seed.request);
    const res = await toolCall(seed.request, pub, alice.conversation_id, 'corpus_search');
    expect(res.status, `public session refused on Alice's conversation: ${res.body}`)
      .toBeGreaterThanOrEqual(400);
  });

  test('a public session cannot write turns into someone else\'s conversation', async () => {
    const tag = await scriptMockReplyText(seed.request, 'ok');
    const res = await turn(seed.request, pub, alice.conversation_id, `${INTRUDER_MARKER}${tag}`);
    expect(res.status, 'the public session is refused on Alice\'s conversation').toBeGreaterThanOrEqual(400);
    expect(await ownerTranscript(seed, alice.conversation_id),
      'Alice\'s transcript holds no intruder turn').not.toContain(INTRUDER_MARKER);

    // Positive control: the public session's own conversation takes its turn.
    const ownTag = await scriptMockReplyText(seed.request, 'ok');
    const own = await turn(seed.request, pub, pub.conversation_id, `hello${ownTag}`);
    expect(own.status, 'the public session talks in its own conversation').toBe(200);
  });

  test('ghost records cannot be written into another visitor\'s conversation', async () => {
    const shown = (sess: VisitorSession) => ghostShown(seed.request, sess, alice.conversation_id);
    expect(await shown(bob), 'Bob refused on Alice\'s conversation').toBeGreaterThanOrEqual(400);
    expect(await shown(pub), 'a public session refused too').toBeGreaterThanOrEqual(400);
    expect(await shown(alice), 'Alice records on her own').toBe(200);
  });

  test('a code member cannot write turns into another member\'s conversation', async () => {
    const tag = await scriptMockReplyText(seed.request, 'ok');
    const res = await turn(seed.request, bob, alice.conversation_id, `${INTRUDER_MARKER}${tag}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ownerTranscript(seed, alice.conversation_id)).not.toContain(INTRUDER_MARKER);
  });
});
