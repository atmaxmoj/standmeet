// visitor-chat-cited-precise.spec.ts —— the cited list only contains entries the AI actually read.
//
// The signature behavior of the retrieval redesign: the old implementation
// counted "the entire corpus stuffed into the prompt" as cited (weak ground
// truth); the new implementation has the AI actively fetch via corpus_read,
// with readCollector accumulating the path — cited = the list of paths the AI
// actually read.
//
// User story:
//   The owner seeds 4 wikis (lucerna / family / sailing / about-me), each with
//   its own independent path. A visitor uses a code to ask "tell me about
//   lucerna" → the mock provider simulates tool-use: corpus_search(query=...)
//   returns 1 match → corpus_read(path=projects/lucerna) → returns text.
//   cited_wiki_refs contains only projects/lucerna.
//
// UI-driven (G-1): visitor opens a real browser → the throbbers
// tool-throbber-corpus_search + tool-throbber-corpus_read appear in order →
// answer-body renders → then admin REST fetches the conversation transcript
// to verify cited precision.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';

test.describe('cited reflects AI agent reads, not prompt-stuffed corpus', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const csrf = await seedFourWikis(request);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'cited-precise spec',
    });
    await request.dispose();
  });

  test('visitor asks narrow question → throbbers fire + cited contains only the read path',
    async ({ browser, playwright }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      // Capture conversation_id from the /sessions response.
      let conversationID = '';
      page.on('response', async (res) => {
        if (res.url().endsWith('/api/v1/sessions') && res.status() === 200) {
          try {
            const body = await res.json() as { conversation_id?: string };
            if (body.conversation_id) conversationID = body.conversation_id;
          } catch { /* noop */ }
        }
      });

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      // #28: the backend owns this rule, persisting at the tail end of the
      // /agent/turn stream (right before the `done` frame). Hook this SSE
      // response before asking the question; res.finished() resolving means the
      // stream finished reading = after done = already persisted, so a
      // transcript query after this point is guaranteed to see cited refs.
      // Hooking before pressing Enter avoids a register-after-action race.
      const turnDone = page.waitForResponse((res) =>
        res.url().includes('/agent/turn') && res.status() === 200,
        { timeout: 20_000 },
      );

      // Mock is pure registration: register the search (so its app-card fires)
      // and the read of lucerna (a corpus_read is what records the citation).
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      // All that's needed here is a stable proof that the agent really
      // searched, really read, and really answered — the throbber is
      // transient, so this test doesn't gamble on it (its real-time behavior
      // is verified separately by throbber-label / throbber-clears). Use
      // persistent signals instead: the collapsed retrieval-summary
      // (UX-10, search ran) + answer-body (turn landed). Which doc got read is
      // precisely asserted below via the cited transcript (containing only projects/lucerna).
      await expect(page.getByTestId('retrieval-summary'))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 20_000 });

      // Wait for this turn's SSE stream to finish reading (= the backend has
      // sunk it into the DB) before the transcript query can see the assistant
      // message + cited refs.
      await (await turnDone).finished();

      expect(conversationID).not.toBe('');

      const reqCtx = await playwright.request.newContext();
      const { csrf } = await loginAPI(reqCtx, OWNER.email, OWNER.password);
      const cited = await fetchCitedRefs(reqCtx, csrf, conversationID);
      expect(cited.wiki.map((r) => r.path)).toEqual([TARGET_PATH]);
      await reqCtx.dispose();

      await ctx.close();
    });
});

async function seedFourWikis(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cited-precise-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: TARGET_PATH,
  });
  await seedWiki(request, token, sid, {
    body: 'my mother is from singapore.',
    title: 'Family', path: 'personal/family',
  });
  await seedWiki(request, token, sid, {
    body: 'I sail on weekends.', title: 'Sailing', path: 'hobbies/sailing',
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
  return csrf;
}

interface CitedRefView { id: string; title: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_wiki_ids: string[]; cited_output_ids: string[] }>;
  wiki_refs: CitedRefView[];
  output_refs: CitedRefView[];
}

async function fetchCitedRefs(
  request: APIRequestContext, csrf: string, conversationID: string,
): Promise<{ wiki: CitedRefView[]; output: CitedRefView[] }> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${conversationID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch failed: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const assistant = body.messages.find((m) => m.role === 'assistant');
  const wikiCited = new Set(assistant?.cited_wiki_ids ?? []);
  const outputCited = new Set(assistant?.cited_output_ids ?? []);
  return {
    wiki: body.wiki_refs.filter((r) => wikiCited.has(r.id)),
    output: body.output_refs.filter((r) => outputCited.has(r.id)),
  };
}
