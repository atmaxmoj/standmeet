// agent-widget-byok.spec.ts —— when the owner's public quota can't serve a visitor, the embedded
// AgentWidget offers "bring your own key" right there, instead of a dead end.
//
// Owner decision (2026-09-25): out of quota (the public provider's gas is spent) or rate-limited
// (the free provider said "retry later") → always offer BYOK. The visitor's key only reads the
// published slice and costs the owner nothing.
//
// Blackbox, asserted on what the upstream actually received (the mock gateway records the model
// and the first 8 chars of the credential per turn):
//   • quota available but the provider rate-limits → the "busy" note comes with a BYOK offer;
//     taking it and entering a key answers the question over the VISITOR's key + model;
//   • quota spent → the widget opens in BYOK mode (not the /gate redirect); the key the visitor
//     enters answers; after a reload the saved key is reused without asking again.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { createCode } from '@/fixtures/codes';
import { openGate, openReader } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import {
  lastGatewayRequest, scriptMockRateLimit, scriptMockReplyText,
} from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'widgetbyok@example.com', password: 'correct-horse-battery-staple',
  handle: 'widgetbyok', fullName: 'Widget BYOK Owner',
};
const SLUG = 'ask-byok';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;
// Obviously-fake words (not digits): a secret scanner must not read a test fixture as a leak.
const VISITOR_KEY = 'sk-fake-visitor-key-for-byok-flow';
// TURN_WAIT —— how long one answer may take here. This spec is about WHOSE key serves the turn,
// not how fast (agent-widget-ask-visitor-card owns the fast-fail timing); on a loaded dev host
// assembling a turn's tools alone was measured at 12–53s ("agent turn prepared" log).
const TURN_WAIT = 90_000;
const VISITOR_MODEL = 'visitor-chosen-model';
const ANSWER = 'Answered on the visitor key.';
const OWNER_TIER_ANSWER = 'Answered on the owner tier again.';
const PUBLIC_KEY = 'sk-public';
const CODE = 'OWNERPAYS-001';
const CODE_KEY = 'sk-code-fake-key-the-owner-pays';
const CODED_ANSWER = 'Answered on the code the owner pays for.';

let providerID = '';
let codeProviderID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · bring your own key when the owner has no quota', () => {
  test.beforeAll(async ({ playwright }) => {
    // One microsite build; measured at ~190s on a loaded dev host (setup 91s + vite 89s), past
    // publishPage's default 180s wait.
    test.setTimeout(600_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: PUBLIC_KEY,
    });
    providerID = pub.id;
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    // The code's own provider: the owner pays for a coded visitor's turns.
    const coded = await createProvider(request, csrf, {
      label: 'code-paid', provider: 'deepseek', endpoint: MOCK, model: 'model-code', key: CODE_KEY,
    });
    codeProviderID = coded.id;
    const role = await createRole(request, csrf, {
      name: 'byok-coded', description: 'owner-paid code', corpus_uris: ['wiki://**'], provider_id: coded.id,
      gas_metered: true, // the code's turns count against its provider's tank, so it can run out
    });
    await createCode(request, csrf, { code: CODE, label: 'owner pays', assumed_role_id: role.id });
    await publishPage(request, csrf, SLUG, APP, 400_000);
    await request.dispose();
  });

  test('rate-limited → busy note offers BYOK → the visitor key answers',
    async ({ playwright, browser }) => { await rateLimitedOffersByok(playwright.request, browser); });

  test('quota spent → BYOK mode (no /gate) → the visitor key answers; a reload reuses it',
    async ({ playwright, browser }) => { await noQuotaOpensByok(playwright.request, browser); });

  // Owner rule: a coded visitor is the owner's guest — the owner pays, and they are never asked to
  // bring a key. Not even when a key is already saved in their browser, and not when the code's own
  // quota runs out.
  test('a coded visitor is never offered BYOK: turns run on the code, even out of quota',
    async ({ playwright, browser }) => { await codedNeverByok(playwright.request, browser); });
});

async function codedNeverByok(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(360_000); // several turns, each up to TURN_WAIT
  const request = await rf.newContext();
  // Same browser: first the codeless visit (public quota is spent by the previous case) saves a key…
  const visitor = await openWidget(browser, 'byok');
  await enterKey(visitor);
  // …then the visitor arrives with a code.
  await openGate(visitor, '/gate');
  await visitor.getByTestId('gate-code').fill(CODE);
  await visitor.getByTestId('gate-visitor-name').fill('Invited Reader');
  await visitor.getByTestId('gate-code-submit').click();
  await expect(visitor.getByTestId('session-strip')).toBeVisible({ timeout: 15_000 });
  await openReader(visitor, `/p/${SLUG}`);
  await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });

  // The turn runs on the code's provider, not the saved visitor key.
  const tag = await scriptMockReplyText(request, CODED_ANSWER);
  await ask(visitor, `what do you build ${tag}`);
  await expect(visitor.getByTestId('agent-widget-transcript')).toContainText(CODED_ANSWER, { timeout: TURN_WAIT });
  expect((await lastGatewayRequest(request, tag)).auth_prefix, 'the owner pays').toBe(CODE_KEY.slice(0, 8));
  expect(await visitor.getByTestId('agent-widget-byok-active').count(), 'no "on your key" for a guest').toBe(0);

  // The code's own quota runs out: the guest is told, and still never asked for a key.
  execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${codeProviderID}'`);
  await ask(visitor, 'one more question');
  await expect(visitor.getByTestId('agent-widget-error'), 'the out-of-quota turn is surfaced')
    .toBeVisible({ timeout: TURN_WAIT });
  const byokUI = visitor.getByTestId('agent-widget').locator(
    '[data-testid="agent-widget-byok-offer"], [data-testid="agent-widget-byok"], [data-testid="agent-widget-byok-active"]',
  );
  expect(await byokUI.count(), 'a coded visitor is never offered BYOK').toBe(0);
  await visitor.context().close();
  await request.dispose();
}

interface RequestFactory { newContext: () => Promise<APIRequestContext> }

async function rateLimitedOffersByok(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(360_000); // several turns, each up to TURN_WAIT
  const request = await rf.newContext();
  const visitor = await openWidget(browser, 'inline');
  await ask(visitor, `hello ${await scriptMockRateLimit(request, 40)}`);
  await expect(visitor.getByTestId('agent-widget-error')).toContainText(/busy/i, { timeout: TURN_WAIT });
  await visitor.getByTestId('agent-widget-byok-offer').click();

  await enterKey(visitor);
  // Start a fresh conversation on the key: the scripted rate limit matches its tag anywhere in the
  // request, and the carried-over history would re-trigger it (a mock artifact, not the product).
  await visitor.getByTestId('agent-widget-clear').click();
  const tag = await scriptMockReplyText(request, ANSWER);
  await ask(visitor, `what do you build ${tag}`);
  await expectVisitorKeyServed(visitor, request, tag);

  // Next visit, the owner's quota is serving again: the saved key does NOT take over. BYOK is for
  // when the owner has no quota (Chrome check 2026-09-25: a key saved on /gate earlier silently ran
  // every turn on the visitor's own account while the owner's tier was fine).
  await visitor.reload();
  await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
  const back = await scriptMockReplyText(request, OWNER_TIER_ANSWER);
  await ask(visitor, `back again ${back}`);
  await expect(visitor.getByTestId('agent-widget-transcript'))
    .toContainText(OWNER_TIER_ANSWER, { timeout: TURN_WAIT });
  expect((await lastGatewayRequest(request, back)).auth_prefix, 'the owner tier serves again')
    .toBe(PUBLIC_KEY.slice(0, 8));
  await visitor.context().close();
  await request.dispose();
}

async function noQuotaOpensByok(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(360_000); // several turns, each up to TURN_WAIT
  // Spend the public tank: metered, filled now with a 0 budget → 0 remaining.
  execSQL(`UPDATE owner_providers SET gas_tokens=0, gas_filled_at=now() WHERE id='${providerID}'`);
  const request = await rf.newContext();
  const visitor = await openWidget(browser, 'byok');
  expect(visitor.url(), 'the codeless visitor stays on the page').toContain(`/p/${SLUG}`);

  await enterKey(visitor);
  const tag = await scriptMockReplyText(request, ANSWER);
  await ask(visitor, `what do you build ${tag}`);
  await expectVisitorKeyServed(visitor, request, tag);

  // The key is kept (encrypted, in this browser): a reload answers without asking again.
  await visitor.reload();
  await expect(visitor.getByTestId('agent-widget-byok-active'), 'the saved key is in use')
    .toBeVisible({ timeout: 20_000 });
  const tag2 = await scriptMockReplyText(request, 'Second answer on the saved key.');
  await ask(visitor, `and after a reload ${tag2}`);
  await expect(visitor.getByTestId('agent-widget-transcript'))
    .toContainText('Second answer on the saved key.', { timeout: TURN_WAIT });
  expect((await lastGatewayRequest(request, tag2)).auth_prefix).toBe(VISITOR_KEY.slice(0, 8));
  await visitor.context().close();
  await request.dispose();
}

async function openWidget(browser: Browser, mode: 'inline' | 'byok'): Promise<Page> {
  const visitor = await (await browser.newContext()).newPage();
  await openReader(visitor, `/p/${SLUG}`);
  await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', mode, { timeout: 20_000 });
  return visitor;
}

// enterKey —— the visitor's own provider: the mock gateway stands in for the vendor endpoint.
async function enterKey(page: Page): Promise<void> {
  await expect(page.getByTestId('agent-widget-byok'), 'the BYOK panel opens').toBeVisible({ timeout: 10_000 });
  // An OpenAI-compatible provider: the mock gateway matches scripted replies on that wire shape.
  await page.getByTestId('agent-widget-byok-provider').selectOption('deepseek');
  await page.getByTestId('agent-widget-byok-endpoint').fill(MOCK);
  await page.getByTestId('agent-widget-byok-model').fill(VISITOR_MODEL);
  await page.getByTestId('agent-widget-byok-key').fill(VISITOR_KEY);
  await page.getByTestId('agent-widget-byok-submit').click();
  await expect(page.getByTestId('agent-widget-byok-active')).toBeVisible({ timeout: 10_000 });
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId('agent-widget-input').fill(text);
  await page.getByTestId('agent-widget-ask').click();
}

async function expectVisitorKeyServed(page: Page, request: APIRequestContext, tag: string): Promise<void> {
  await expect(page.getByTestId('agent-widget-transcript')).toContainText(ANSWER, { timeout: TURN_WAIT });
  const rec = await lastGatewayRequest(request, tag);
  expect(rec.auth_prefix, 'the turn ran on the visitor\'s key').toBe(VISITOR_KEY.slice(0, 8));
  expect(rec.model, 'with the visitor\'s model').toBe(VISITOR_MODEL);
}
