// microsite-page-text-gated.spec.ts —— a chat turn gets a microsite's text only if the session
// could open that page itself.
//
// A turn asked on a microsite carries doc_context {genre: "microsite", path: <slug>} and the
// backend injects that page's prerendered text into the instruction (microsite-agent-reads-page).
// The slug comes from the browser, so any session — even a codeless public one — could name a
// page that is closed to visitors without a code and have its text read to the model (and
// repeated back). Contract: page text reaches the model only for a page the session may open
// (open without a code, or the session's code is bound to it); otherwise the turn runs without it.
//
// Observation point: the mock gateway's record of every request — the page's marker either
// reached the model or it did not. Positive control: a code bound to the closed page does get
// its text, so a green cannot come from page text being off for everyone.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { bindCodeToPage, publishPage, setPageOpenWithoutCode } from '@/fixtures/microsite-rig';
import { gatewayRequestExists, resetGatewayRequests, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'pagegate@example.com', password: 'correct-horse-battery-staple',
  handle: 'pagegate', fullName: 'Page Gate Owner',
};
const SLUG = 'closed-notes';
const PAGE_FACT = 'CLOSED-PAGE-MARKER the vault code is 4471';

const SOURCE = `
export default function App() {
  return (<main><h1>Closed notes</h1><p>${PAGE_FACT}</p></main>);
}
`;

async function turnOnPage(
  request: APIRequestContext, sess: VisitorSession,
): Promise<number> {
  const tag = await scriptMockReplyText(request, 'ok');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: {
      user_message: `what does this page say?${tag}`, conversation_id: sess.conversation_id,
      doc_context: { genre: 'microsite', path: SLUG, title: '' },
    },
  });
  await res.text();
  return res.status();
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.describe('microsite page text · only for a page the session may open', () => {
  let request: APIRequestContext;
  let csrf = '';
  let codeID = '';
  let code = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await publishPage(request, csrf, SLUG, SOURCE);
    await setPageOpenWithoutCode(request, csrf, SLUG, false);
    const c = await createCode(request, csrf, { code: 'PAGE-GATE1', label: 'pagegate' });
    codeID = c.id;
    code = c.code;
    await bindCodeToPage(request, csrf, codeID, SLUG);
  });
  test.afterAll(async () => { await request.dispose(); });

  test('a public session naming the closed page gets none of its text', async () => {
    const pub = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'Anon' });
    await resetGatewayRequests(request);
    expect(await turnOnPage(request, pub), 'the turn itself still runs').toBe(200);
    expect(await gatewayRequestExists(request, 'CLOSED-PAGE-MARKER'),
      'the closed page\'s text never reached the model').toBe(false);
  });

  test('a code session not bound to the page gets none of its text', async () => {
    const other = await createCode(request, csrf, { code: 'PAGE-GATE2', label: 'unbound' });
    const sess = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code: other.code, visitor_name: 'Unbound',
    });
    await resetGatewayRequests(request);
    expect(await turnOnPage(request, sess)).toBe(200);
    expect(await gatewayRequestExists(request, 'CLOSED-PAGE-MARKER')).toBe(false);
  });

  test('positive control: the code bound to the page does get its text', async () => {
    const sess = await issueSession(request, {
      handle: OWNER.handle, mode: 'code', code, visitor_name: 'Bound',
    });
    await resetGatewayRequests(request);
    expect(await turnOnPage(request, sess)).toBe(200);
    expect(await gatewayRequestExists(request, 'CLOSED-PAGE-MARKER'),
      'the bound code reads its page').toBe(true);
  });
});
