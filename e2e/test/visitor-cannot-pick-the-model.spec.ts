// visitor-cannot-pick-the-model.spec.ts —— a visitor's turn runs on the model the owner set.
//
// Found 2026-10-07 while measuring the agent speedup: the turn request's `model` field replaced
// the model of the owner's provider, for any visitor session. No client of ours sends it, but
// anyone with a session could: a public visitor could run the owner's key on the provider's
// most expensive model, or one the owner chose not to use. The owner picks the model (on the
// provider, the role or the code); the visitor's request does not.
//
// The mock gateway records the model each request asked for.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { lastGatewayRequest, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'model@example.com', password: 'visitor-model-pass-1',
  handle: 'modelowner', fullName: 'Model Owner',
};
const CODE = 'MODEL-001';
const PICKED = 'visitor-picked-expensive-model';

test.describe('a visitor cannot choose the model their turn runs on', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'model-seed');
    const sid = await initMCP(request, token);
    await seedPublicWiki(request, token, sid, { body: 'model intro.', title: 'Model Intro' });
    await createCode(request, csrf, { code: CODE, label: 'Model' });
    await request.dispose();
  });

  test('a turn that names a model still runs on the owner\'s', async ({ request }) => {
    const sess = await issueSession(request,
      { handle: OWNER.handle, code: CODE, visitor_name: 'Picker' });
    const tag = await scriptMockReplyText(request, 'ok.');
    const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: {
        system: '', user_message: `hello ${tag}`, conversation_id: sess.conversation_id,
        history: [], model: PICKED,
      },
    });
    expect(res.status()).toBe(200);
    await res.text();

    const seen = await lastGatewayRequest(request, tag);
    expect(seen.found, 'the turn reached the model').toBe(true);
    expect(seen.model, 'the owner\'s provider model, not the one the visitor named')
      .not.toBe(PICKED);
    expect(seen.model).not.toBe('');
  });
});
