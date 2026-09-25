// agent-widget-ask-visitor-card.spec.ts —— the embedded AgentWidget behaves like the main chat
// around tool cards. Prod (2026-09-24/25, /p/lucerna, public tier):
//   • the model called ask_visitor; the widget rendered nothing (no card host) and the backend
//     read the card turn as "no answer" and forced a synthesis on top of it (Groq 400);
//   • once cards rendered: every corpus_search showed up as its own "searched · 0 entries" card
//     (the card miscounted, and the main chat never shows these — it collapses retrieval);
//   • the ask_visitor card was dark-on-dark on the dark-mode page;
//   • the model didn't know which page "it" referred to, so it asked back instead of answering;
//   • the free public provider rate-limited with a 40s retry-after and the visitor sat in silence.
//
// Asserted, blackbox (one page, several turns):
//   • the card renders, with the model's question/options; clicking an option sends it as the
//     visitor's next message; the card turn ends as the card (its stop line logged, no forced
//     synthesis); the turn carries the page the visitor is on;
//   • a retrieval call leaves no card; the answer lands;
//   • in dark mode the card question is light text;
//   • a long retry-after on the public tier fails fast with a clear note.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, FrameLocator, Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { backendLogTail, execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import {
  lastGatewayRequest, scriptMockRateLimit, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'widgetask@example.com', password: 'correct-horse-battery-staple',
  handle: 'widgetask', fullName: 'Widget Ask Owner',
};
const SLUG = 'ask-card';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget placeholder="Ask" /></main>;
}`;
const QUESTION = 'Do you mean available in France, or a French interface?';
const OPTIONS = ['Available in France', 'French interface', 'Both'];
const ANSWER_AFTER_SEARCH = 'I mostly read novels in the language I am learning.';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('AgentWidget · tool cards, page context, rate limits', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300_000); // one microsite build
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    await publishPage(request, csrf, SLUG, APP);
    await request.dispose();
  });

  test('the card renders, answering sends the choice, no forced synthesis, page context sent',
    async ({ playwright, browser }) => { await cardTurn(playwright.request, browser); });

  test('a retrieval call leaves no card; the answer lands',
    async ({ playwright, browser }) => { await retrievalTurn(playwright.request, browser); });

  test('in dark mode the card follows the page theme (readable text, not dark-on-dark)',
    async ({ playwright, browser }) => { await darkCard(playwright.request, browser); });

  test('public tier: a rate limit with a long retry-after fails fast with a clear note',
    async ({ playwright, browser }) => { await rateLimitedTurn(playwright.request, browser); });
});

interface RequestFactory { newContext: () => Promise<APIRequestContext> }

async function cardTurn(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(120_000);
  const request = await rf.newContext();
  const tag = await scriptMockToolCall(request, {
    name: 'ask_visitor', args: { question: QUESTION, kind: 'radio', options: OPTIONS },
  });
  const visitor = await openWidget(browser);
  const logBefore = new Date().toISOString();
  await ask(visitor, `can I use it in French ${tag}`);

  const frame = await assertCard(visitor);
  // The card is sized to its content. The cards measured documentElement.scrollHeight, which
  // never drops below the iframe's own height: every report ratcheted it up to the 600px cap,
  // leaving a tall blank box (prod, Claude-in-Chrome, 2026-09-25).
  await expect.poll(() => visitor.getByTestId('mcp-app-card-ask_visitor').evaluate((e) => e.clientHeight),
    { timeout: 10_000, message: 'a 3-option card is not a 600px box' }).toBeLessThan(320);
  // The turn is over (its stop line is logged) and it ended as the card — no forced synthesis.
  await expect.poll(() => turnLog(logBefore).includes('agent turn stop'), {
    timeout: 20_000, message: 'the card turn finished',
  }).toBe(true);
  expect(turnLog(logBefore), 'a card turn is not "no answer"').not.toContain('forcing synthesis');
  // The agent is told which page the visitor is on ("can I use IT" → this page).
  const rec = await lastGatewayRequest(request, tag, 'currently reading the page');
  expect(rec.contains, 'the turn carries the page the visitor is on').toBe(true);

  await frame.getByTestId('ask-visitor-opt-1').click();
  await expect(visitor.locator('[data-testid="agent-widget-transcript"] [data-role="visitor"]').last(),
    'the choice is sent as the visitor\'s next message').toContainText(OPTIONS[1], { timeout: 10_000 });
  await visitor.context().close();
  await request.dispose();
}

async function retrievalTurn(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(120_000);
  const request = await rf.newContext();
  const toolTag = await scriptMockToolCall(request, { name: 'corpus_search', args: { query: 'reading' } });
  const replyTag = await scriptMockReplyText(request, ANSWER_AFTER_SEARCH);
  const visitor = await openWidget(browser);
  await ask(visitor, `what do you read ${toolTag}${replyTag}`);
  await expect(visitor.getByTestId('agent-widget-transcript'))
    .toContainText(ANSWER_AFTER_SEARCH, { timeout: 30_000 });
  // Same rule as the main chat: retrieval collapses, it isn't a card per search.
  expect(await visitor.getByTestId('agent-widget').locator('iframe').count(),
    'no card iframe for a retrieval tool').toBe(0);
  await visitor.context().close();
  await request.dispose();
}

async function darkCard(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(120_000);
  const request = await rf.newContext();
  const tag = await scriptMockToolCall(request, {
    name: 'ask_visitor', args: { question: QUESTION, kind: 'radio', options: OPTIONS },
  });
  const visitor = await openWidget(browser, 'dark');
  await ask(visitor, `can I use it in French ${tag}`);
  const frame = await assertCard(visitor);
  const pageBg = await visitor.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const textColor = await frame.getByTestId('ask-visitor-question')
    .evaluate((el) => getComputedStyle(el).color);
  expect(luminance(pageBg), 'the page really is dark').toBeLessThan(0.3);
  expect(luminance(textColor), 'the card question is light text on the dark page').toBeGreaterThan(0.5);

  // A reload restores the conversation text, never a stored card: the card html is a snapshot of
  // that moment, and persisting it resurrected stale cards forever (prod: old "searched · 0
  // entries" + light-palette cards kept coming back after v0.1.67 fixed both).
  await visitor.reload();
  await expect(visitor.getByTestId('agent-widget-transcript'), 'the question survives the reload')
    .toContainText('can I use it in French', { timeout: 20_000 });
  expect(await visitor.getByTestId('agent-widget').locator('iframe').count(),
    'no card is restored from storage').toBe(0);
  await visitor.context().close();
  await request.dispose();
}

async function rateLimitedTurn(rf: RequestFactory, browser: Browser): Promise<void> {
  test.setTimeout(120_000);
  const request = await rf.newContext();
  const tag = await scriptMockRateLimit(request, 40);
  const visitor = await openWidget(browser);
  const asked = Date.now();
  await ask(visitor, `hello ${tag}`);
  // Waiting out a 40s retry-after in silence looked like a dead page (prod, Groq free tier).
  await expect(visitor.getByTestId('agent-widget-error'), 'the visitor is told, promptly')
    .toContainText(/busy/i, { timeout: 15_000 });
  expect(Date.now() - asked, 'did not sit out the retry-after').toBeLessThan(20_000);
  await visitor.context().close();
  await request.dispose();
}

async function openWidget(browser: Browser, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
  const visitor = await (await browser.newContext({ colorScheme })).newPage();
  await openReader(visitor, `/p/${SLUG}`);
  await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
  return visitor;
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId('agent-widget-input').fill(text);
  await page.getByTestId('agent-widget-ask').click();
}

async function assertCard(page: Page): Promise<FrameLocator> {
  await expect(page.getByTestId('agent-widget').getByTestId('mcp-app-card-ask_visitor'),
    'the widget renders the ask_visitor card').toBeVisible({ timeout: 20_000 });
  const frame = page.frameLocator('[data-testid="mcp-app-card-ask_visitor"]');
  await expect(frame.getByTestId('ask-visitor-question')).toHaveText(QUESTION, { timeout: 10_000 });
  for (let i = 0; i < OPTIONS.length; i++) {
    await expect(frame.getByTestId(`ask-visitor-opt-${i}`)).toHaveText(OPTIONS[i]);
  }
  return frame;
}

// turnLog —— backend log lines stamped at or after `since` (ISO time; the JSON lines carry "time").
function turnLog(since: string): string {
  return backendLogTail(4000).split('\n')
    .filter((l) => (/"time":"([^"]+)"/.exec(l)?.[1] ?? '') >= since)
    .join('\n');
}

// luminance —— relative luminance (0 dark … 1 light) of a computed `rgb(...)` / `rgba(...)` color.
function luminance(css: string): number {
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
