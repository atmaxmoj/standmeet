// agent-turn-rate-limited-upstream.spec.ts —— what a visitor gets when the AI provider says 429.
//
// Two gaps left after v0.1.67 taught the public tier to fail fast on a long retry-after:
//   A. After a retrieval step, a long retry-after surfaced the "busy" error — and then the turn,
//      having evidence but no answer, forced one more synthesis call on top of it: another request
//      into the same rate limit, and text that could land after the error.
//   B. A 429 the provider keeps returning within the wait budget ends, once the retries are spent,
//      as the SDK's own error. Nothing read its status, so the visitor saw "Something went wrong"
//      — as if it were our fault — instead of "busy, try again".
//
// Blackbox: a microsite with the AgentWidget on the public tier, the mock provider scripted per
// turn. The visitor's words are asserted; for A, the backend's own turn log is the only place a
// second model call is visible (same method as agent-widget-ask-visitor-card).

import { test, expect } from '@/fixtures/test';
import type { Browser, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { backendLogTail, execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';
import { publishPage } from '@/fixtures/microsite-rig';
import { createProvider } from '@/fixtures/providers';
import { scriptMockRateLimit, scriptMockToolCall } from '@/fixtures/mock-llm-script';

const MOCK = 'http://llm-gateway:9300';
const OWNER = {
  email: 'ratelimited@example.com', password: 'correct-horse-battery-staple',
  handle: 'ratelimited', fullName: 'Rate Limited Owner',
};
const SLUG = 'ask-busy';
const APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><AgentWidget /></main>;
}`;

let token = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('agent turn · the provider says 429', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(400_000); // one microsite build
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const pub = await createProvider(request, csrf, {
      label: 'public-free', provider: 'deepseek', endpoint: MOCK, model: 'model-public', key: 'sk-public',
    });
    execSQL(`UPDATE roles SET provider_id='${pub.id}' WHERE name='public'`);
    token = await createAPIToken(request, csrf, 'ratelimited-seed');
    sid = await initMCP(request, token);
    await publishPage(request, csrf, SLUG, APP, 400_000);
    await request.dispose();
  });

  test('A · rate-limited after a retrieval step: the visitor is told, and no extra call is forced',
    async ({ playwright, browser }) => {
      test.setTimeout(180_000);
      const request = await playwright.request.newContext();
      // The limit's key lives only in a published note, so only the call AFTER the search (which
      // carries the search result) hits it; the first call is the scripted search.
      const limitTag = await scriptMockRateLimit(request, 40);
      const key = rawKey(limitTag);
      const { wikiID } = await seedWiki(request, token, sid, {
        title: `Reading notes ${key}`, body: `What I read, and why. ${key}`, path: `notes/reading-${key}`,
      });
      await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
      const searchTag = await scriptMockToolCall(request, {
        name: 'corpus_search', args: { query: `Reading notes ${key}` },
      });

      const visitor = await openWidget(browser);
      const logBefore = new Date().toISOString();
      await ask(visitor, `what do you read ${searchTag}`);
      await expect(visitor.getByTestId('agent-widget-error'), 'the visitor is told the AI is busy')
        .toContainText(/busy/i, { timeout: 30_000 });
      await expect.poll(() => turnLog(logBefore).includes('agent turn stop'), {
        timeout: 30_000, message: 'the turn finished',
      }).toBe(true);
      expect(turnLog(logBefore), 'the search did run: the turn had evidence')
        .toContain('corpus_search');
      expect(turnLog(logBefore), 'no synthesis is forced into the same rate limit')
        .not.toContain('forcing synthesis');
      await visitor.context().close();
      await request.dispose();
    });

  test('B · a 429 that outlasts the retries reads as "busy", not as our fault',
    async ({ playwright, browser }) => {
      test.setTimeout(180_000);
      const request = await playwright.request.newContext();
      // 1s is inside the public tier's wait budget: the client honours it and retries, and the
      // provider keeps saying 429 until the retries are spent.
      const tag = await scriptMockRateLimit(request, 1);
      const visitor = await openWidget(browser);
      await ask(visitor, `hello ${tag}`);
      const error = visitor.getByTestId('agent-widget-error');
      await expect(error, 'the visitor is told the AI is busy').toContainText(/busy/i, { timeout: 90_000 });
      await expect(error).not.toContainText(/went wrong/i);
      await visitor.context().close();
      await request.dispose();
    });
});

// rawKey —— the key inside a `[[s:KEY]]` tag: what the mock matches on.
function rawKey(tag: string): string {
  return tag.trim().replace(/^\[\[s:/, '').replace(/\]\]$/, '');
}

// turnLog —— the backend log lines since `since` (an ISO time; the log lines carry one).
function turnLog(since: string): string {
  return backendLogTail(4000).split('\n')
    .filter((l) => (/"time":"([^"]+)"/.exec(l)?.[1] ?? '') >= since)
    .join('\n');
}

async function openWidget(browser: Browser): Promise<Page> {
  const visitor = await (await browser.newContext()).newPage();
  await openReader(visitor, `/p/${SLUG}`);
  await expect(visitor.getByTestId('agent-widget')).toHaveAttribute('data-mode', 'inline', { timeout: 20_000 });
  return visitor;
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId('agent-widget-input').fill(text);
  await page.getByTestId('agent-widget-input').press('Enter');
}
