// visitor-failures-read-as-sentences.spec.ts —— whatever goes wrong under a visitor's question, the
// visitor reads a plain sentence in their language, never an error code (owner, 2026-10-04, on the
// live home page: "error: issue session: 400 —— 这可不user-friendly").
//
// The owner's home page is a microsite with the SDK's <AgentWidget/>, answering codeless visitors
// in place on the public tier. Three ways a question failed there that day:
//   1. A browser still remembered a code whose sessions had been purged (the code was revoked).
//      The widget asked for a code session with an empty code, the backend answered 400, and the
//      page printed "error: issue session: 400". A visitor whose code is gone is a public visitor:
//      the question must simply be answered on the public tier.
//   2. The public tier's provider refused the request as too large for its per-minute token cap
//      (Groq answers 413). The backend called that "internal" and the visitor read "Something went
//      wrong on my end". The honest sentence says the question was too big for this chat.
//   3. Any failure before a turn starts (here: opening the session fails) printed `error: <raw>`.
//
// Asserted: the words on screen. Each test first proves text is there, so "doesn't contain a leak
// marker" cannot pass on an empty answer.

import { test, expect } from '@/fixtures/test';
import type { Browser, Locator, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode, revokeCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken, execSQL } from '@/fixtures/instance';
import { publishPage } from '@/fixtures/microsite-rig';
import { scriptMockReplyText, scriptMockTooLarge } from '@/fixtures/mock-llm-script';
import { enterCodeSession, openReader } from '@/fixtures/navigate';
import { createProvider } from '@/fixtures/providers';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'failsentence@example.com', password: 'correct-horse-battery-staple',
  handle: 'failsentence', fullName: 'Fail Sentence Owner',
};
const CODE = 'FAILSENT-1';
const SLUG = 'ask-home';
const PAGE = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask me anything" /></main>;
}`;
// LEAK —— anything here in front of a visitor means internals leaked.
const LEAK = /error:|issue session|\b(400|401|413|500|503)\b|internal|NodeRunError|Request Entity/i;
const TOO_LARGE_EN = 'That question needs more than this chat can take at once — try a narrower question, '
  + 'or ask for an access code for a fuller conversation.';
const UNREACHABLE_EN = 'I couldn’t reach the chat just now — please try again in a moment.';

test.describe('a failed question reads as a sentence, never an error code', () => {
  let codeID = '';
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    codeID = (await createCode(request, csrf, { code: CODE, label: 'fail sentence' })).id;
    // The public tier answers codeless visitors in place, as on sijie.xyz: a provider on the
    // `public` role, pointed at the mock gateway.
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    await publishPage(request, csrf, SLUG, PAGE);
    await request.dispose();
  });

  test('a visitor whose code was revoked is answered on the public tier', async ({ browser, playwright }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);

    const admin = await playwright.request.newContext();
    const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
    await revokeCode(admin, csrf, codeID);
    await admin.dispose();

    const tag = await scriptMockReplyText(page.request, 'Public tier answering after the code was revoked.');
    const widget = await openAsk(page);
    await ask(widget, `what are you working on${tag}`);
    // The FIRST words the visitor reads are the answer: the dead session's "Re-open your access
    // link" never flashes up before the question is asked again (it did, 2026-10-05, 1 run in 4).
    const shown = await answerText(widget);
    expect(shown).toContain('Public tier answering after the code was revoked.');
    expect(shown, `visitor saw internals: ${shown}`).not.toMatch(LEAK);
    await ctx.close();
  });

  test('a revoked code\'s link: no "access granted" name picker, the gate instead', revokedCodeLink);

  test('a provider that refuses the request as too large reads as "too big for this chat"', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const widget = await openAsk(page);
    const tag = await scriptMockTooLarge(page.request);
    await ask(widget, `tell me everything you know${tag}`);
    const shown = await answerText(widget);
    expect(shown).toContain(TOO_LARGE_EN);
    expect(shown, `visitor saw internals: ${shown}`).not.toMatch(LEAK);
    await ctx.close();
  });

  test('a failure before the turn starts reads as a sentence', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const widget = await openAsk(page);
    // The session request fails on the wire (the visitor's network or the instance); the visitor
    // still reads a sentence. Fault injection outside the product, after the page has loaded.
    await page.route('**/api/v1/sessions', (route) => route.fulfill({ status: 503, body: '' }));
    await ask(widget, 'hello');
    const shown = await answerText(widget);
    expect(shown).toContain(UNREACHABLE_EN);
    expect(shown, `visitor saw internals: ${shown}`).not.toMatch(LEAK);
    await ctx.close();
  });
});

// revokedCodeLink —— sijie.xyz, 2026-10-05: opening /?code=<revoked> greeted the visitor "ACCESS
// GRANTED · CODE …" and asked for a name; only the name's submit found out the code refuses them.
async function revokedCodeLink(
  { browser, playwright }: { browser: Browser; playwright: Playwright },
): Promise<void> {
  test.setTimeout(120_000);
  const code = 'FAILSENT-BACK';
  const admin = await playwright.request.newContext();
  const { csrf } = await loginAPI(admin, OWNER.email, OWNER.password);
  await revokeCode(admin, csrf, (await createCode(admin, csrf, { code, label: 'come back' })).id);
  await admin.dispose();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let pickerSeen = false;
  const watch = page.getByTestId('visitor-name-overlay').waitFor({ timeout: 15_000 })
    .then(() => { pickerSeen = true; }, () => undefined);
  await openReader(page, `/?code=${code}`);
  await expect(page, 'a closed code lands on the gate').toHaveURL(/\/gate/, { timeout: 15_000 });
  await watch;
  expect(pickerSeen, 'the name picker never showed for a revoked code').toBe(false);
  await ctx.close();
}

// openAsk —— the home-like page, its widget answering in place.
async function openAsk(page: Page): Promise<Locator> {
  await openReader(page, `/p/${SLUG}`);
  const widget = page.getByTestId('agent-widget');
  await expect(widget, 'codeless visitor + public provider → answers in place')
    .toHaveAttribute('data-mode', 'inline', { timeout: 30_000 });
  return widget;
}

async function ask(widget: Locator, q: string): Promise<void> {
  const input = widget.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function answerText(widget: Locator): Promise<string> {
  const body = widget.getByTestId('answer-body').last();
  await expect(body).toBeVisible({ timeout: 90_000 });
  await expect(body).not.toHaveText('', { timeout: 90_000 });
  const shown = await body.innerText();
  expect(shown.trim().length, 'the visitor must be told something').toBeGreaterThan(0);
  return shown;
}
