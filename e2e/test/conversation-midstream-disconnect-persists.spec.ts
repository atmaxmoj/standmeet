// conversation-midstream-disconnect-persists.spec.ts — #28: the backend owns this turn.
//
// Business property: a visitor asks a question, and the connection drops mid-answer
// (a refresh / closed tab / dropped network). The real owner of this turn lives on the
// backend — the agent's event stream sinks into the conversation table at its tail end,
// **not depending on the client staying present**. So even if the client disappears
// mid-turn, the backend still finishes the turn and persists it; reading the
// conversation back afterward, the turn is there, the answer is complete, count +1.
//
// This complements conversation-*-survive-reload.spec.ts: those test "history already
// persisted survives a refresh"; this one tests "disconnecting mid-answer still gets
// that turn persisted" — i.e. the backend sink doesn't depend on the frontend.
//
// Disconnect simulation: give it a slow answer (embed [[think:N]] in user_message so the
// mock sleeps N ms before producing an answer), set POST /agent/turn's timeout shorter
// than N → Playwright aborts the request mid-flight (= the client disconnecting). Then
// poll GET /conversations/{id} until the turn shows up.
//
// Before the fix (the loop was bound to r.Context() and didn't persist): client abort →
// ctx cancelled → the loop died on the spot, nobody persisted anything → polling timed
// out → failure. After the fix (a detached ctx + a DB sink at the stream's tail end):
// abort doesn't affect the loop, the mock finishes sleeping and produces the answer, the
// backend accumulates it + sinks into the DB → polling sees the turn.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';
import type { VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'midstream@example.com', password: 'correct-horse-battery-staple',
  handle: 'midstream', fullName: 'Midstream Owner',
};

const CODE = 'MIDSTREAM-001';

// THINK_MS — how long the mock sleeps before producing the final answer.
// DISCONNECT_MS < THINK_MS, so the client disconnects before the answer even starts
// streaming out, making it a genuine "connection dropped mid-answer".
const THINK_MS = 3000;
const DISCONNECT_MS = 1000;

const ANSWER = 'I have been wiring the deterministic state holder all week.';

async function setupOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'midstream-role', description: 'midstream spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'midstream', assumed_role_id: role.id,
  });
  await request.dispose();
}

interface ConvDialog { question: string; answer: string }

async function fetchDialogs(
  request: APIRequestContext, sess: VisitorSession,
): Promise<ConvDialog[]> {
  const res = await request.get(
    `${BACKEND}/api/v1/conversations/${sess.conversation_id}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } },
  );
  if (res.status() !== 200) return [];
  const body = await res.json() as { conversation?: { dialogs?: ConvDialog[] } };
  return body.conversation?.dialogs ?? [];
}

// disconnectMidStream — POSTs /agent/turn but aborts after only DISCONNECT_MS,
// simulating the client leaving mid-answer. The Playwright timeout will reject + close
// the connection; this swallows that rejection (it's the disconnect we actually want).
async function disconnectMidStream(
  request: APIRequestContext, sess: VisitorSession, userMessage: string,
): Promise<void> {
  try {
    await request.post(`${BACKEND}/api/v1/agent/turn`, {
      headers: {
        Authorization: `Bearer ${sess.session_token}`,
        'Content-Type': 'application/json',
      },
      data: {
        system: 'You are alice.', user_message: userMessage,
        conversation_id: sess.conversation_id,
      },
      timeout: DISCONNECT_MS,
    });
    throw new Error('expected the mid-stream request to be aborted, but it returned');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('expected the mid-stream')) throw e;
    // Playwright TimeoutError — expected, this is the client disconnecting.
  }
}

test.describe('conversation · mid-stream disconnect 后端照样落库', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupOwner(playwright);
  });

  test('答到一半断开 → 后端跑完 + sink 进 conversation', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, {
      handle: OWNER.handle, code: CODE, visitor_name: 'V',
    });

    const tag = await scriptMockReplyText(request, ANSWER);
    const userMessage = `what are you working on [[think:${THINK_MS}]]${tag}`;
    await disconnectMidStream(request, sess, userMessage);

    // The client is already gone. The backend finishes this turn + persists it on a
    // detached ctx; poll until the turn shows up.
    await expect.poll(
      async () => (await fetchDialogs(request, sess)).length,
      { timeout: 15_000, intervals: [300, 500, 800] },
    ).toBe(1);

    const dialogs = await fetchDialogs(request, sess);
    expect(dialogs[0]?.answer).toContain(ANSWER);
    expect(dialogs[0]?.question).toBe(userMessage);

    await request.dispose();
  });
});
