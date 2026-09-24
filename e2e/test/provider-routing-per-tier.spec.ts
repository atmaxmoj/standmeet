// provider-routing-per-tier.spec.ts —— the provider a turn uses is chosen per tier:
// code's provider > (public role's provider) > owner default. A code with a provider attached
// uses THAT provider; a code with none falls back to the default; an anonymous public turn uses
// the provider designated for the public tier (the `public` role's provider), NOT the default.
//
// Faithful because each provider row points at the SAME mock gateway but declares a DISTINCT
// model id, and the gateway request RECORDER (lastGatewayRequest(tag).model) reports which model
// the backend actually called — so we read the real outbound choice, not a UI label.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { createProvider, setDefaultProvider } from '@/fixtures/providers';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import { scriptMockReplyText, lastGatewayRequest, resetGatewayRequests } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'provrouting@example.com', password: 'correct-horse-battery-staple',
  handle: 'provrouting', fullName: 'Provider Routing Owner',
};
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// Three provider rows, same mock endpoint, distinct models so the recorder tells them apart.
const DEF = { label: 'paid-default', provider: 'deepseek', endpoint: MOCK, model: 'model-default', key: 'sk-def' };
const CODED = { label: 'coded-provider', provider: 'deepseek', endpoint: MOCK, model: 'model-coded', key: 'sk-coded' };
const PUBLIC = { label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public' };

async function turnModel(request: APIRequestContext, sess: VisitorSession): Promise<string> {
  const tag = await scriptMockReplyText(request, 'ok answer');
  await runVisitorChatTurn(request, sess, `hi ${tag}`);
  const rec = await lastGatewayRequest(request, tag);
  expect(rec.found, 'gateway recorded the outbound call').toBe(true);
  return rec.model;
}

test.describe('provider routing · code > public-role > default', () => {
  let csrf = '';
  let codedProviderID = '';
  let publicProviderID = '';

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    const def = await createProvider(request, csrf, { ...DEF, is_default: true });
    await setDefaultProvider(request, csrf, def.id);
    const coded = await createProvider(request, csrf, CODED);
    const pub = await createProvider(request, csrf, PUBLIC);
    codedProviderID = coded.id;
    publicProviderID = pub.id;
    // Codes are admin-authed — create them here on the logged-in context (a per-test fresh context
    // has no admin cookie).
    await createCode(request, csrf, { code: 'ROUTE-CODED', label: 'coded', provider_id: codedProviderID, max_turns_per_session: 10 });
    await createCode(request, csrf, { code: 'ROUTE-PLAIN', label: 'plain', max_turns_per_session: 10 });
    await resetGatewayRequests(request);
    await request.dispose();
  });

  test('a coded turn uses the code’s attached provider', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: 'ROUTE-CODED', visitor_name: 'Coded V' });
    expect(await turnModel(request, sess)).toBe('model-coded');
    await request.dispose();
  });

  test('a coded turn with no provider falls back to the default', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const sess = await issueSession(request, { handle: OWNER.handle, mode: 'code', code: 'ROUTE-PLAIN', visitor_name: 'Plain V' });
    expect(await turnModel(request, sess)).toBe('model-default');
    await request.dispose();
  });

  test('an anonymous public turn uses the public-tier provider, not the default', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    // Designate the public provider by pointing the `public` role at it (the mechanism the UI will drive).
    execSQL(`UPDATE roles SET provider_id='${publicProviderID}' WHERE name='public'`);
    const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'Anon' });
    expect(await turnModel(request, sess)).toBe('model-public');
    await request.dispose();
  });
});
