// byoai-never-falls-back-to-owner.spec.ts —— a "bring your own key" session is served by the
// visitor's key or not at all. Never by the owner's.
//
// Prod, 2026-09-26 (Claude-in-Chrome on /p/lucerna): the owner's own browser had lost the wrap key
// of its saved BYOAI key (IndexedDB entry gone, the localStorage envelope still there), so the
// widget sent the turn with NO key headers. The backend resolved a byoai session with no visitor
// key by falling through to the owner's provider: the turn ran on the owner's free Groq tier
// (`mode:byoai model:openai/gpt-oss-120b`), sat out 28s/34s/48s retry-afters — the "2.5 minutes,
// no answer" the owner had reported — while the widget said "on your deepseek key".
//
// It is also a billing hole: anyone can open a byoai session without a key and chat on the owner's
// provider, and byoai turns are not metered.
//
// Blackbox over the visitor API: a byoai session, a turn without a key. The owner's provider is
// the mock, with a reply scripted for this turn — if the owner's provider is ever called, the mock
// records a request carrying the tag.

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { createProvider } from '@/fixtures/providers';
import { issueByoaiSession } from '@/fixtures/visitor';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import { gatewayRequestExists, resetGatewayRequests, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'byoaionly@example.com', password: 'correct-horse-battery-staple',
  handle: 'byoaionly', fullName: 'BYOAI Only Owner',
};

test.describe('byoai · the visitor\'s key or nothing', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createProvider(request, csrf, {
      label: 'owner-pays', provider: 'deepseek', endpoint: MOCK, model: 'model-owner',
      key: 'sk-owner-pays-for-this', is_default: true,
    });
    await request.dispose();
  });

  test('a byoai turn without the visitor\'s key is refused — the owner\'s provider is never called', async (
    { request },
  ) => {
    await resetGatewayRequests(request);
    const tag = await scriptMockReplyText(request, 'Answered on the owner\'s provider.');
    const sess = await issueByoaiSession(request, {
      handle: OWNER.handle, byoai_provider: 'deepseek',
      // No key reaches the server: the browser could not read its saved key.
      byoai_key: '', byoai_endpoint: '', byoai_model: '',
    });

    const res = await runVisitorChatTurn(request, sess, `what do you build ${tag}`);

    expect(res.status(), 'the turn is refused, not answered').toBe(401);
    expect(await res.text(), 'the visitor is told to add their key again').toMatch(/key/i);
    expect(await gatewayRequestExists(request, tag.trim()), 'the owner\'s provider was never called')
      .toBe(false);
  });
});
