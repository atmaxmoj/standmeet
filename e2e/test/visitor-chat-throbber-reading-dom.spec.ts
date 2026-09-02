// visitor-chat-throbber-reading-dom.spec.ts — the DOM-layer guard for #9.
//
// throbber-label.spec verifies that the SSE stream (network layer) carries
// corpus_read + path; this test covers the remaining step — the frontend
// **actually painting "reading <document>" into the DOM** — because what the owner
// cares about is "what he's reading has to be visible to the eye", not just present
// in a network frame.
//
// The hard part: in a zero-latency mock turn, the throbber flashes by too fast for
// the DOM to render it. The fix: embed [[slow-final:N]] in the question — the
// gateway holds for N ms after corpus_read and before emitting the final answer,
// and during that window currentTool is still corpus_read (tool_completed doesn't
// clear it, only llm_chunk does), so the "reading X" throbber stays up long enough
// to assert against.
//
// This test also guards against a real bug that once existed: SSE proxied through
// Next's rewrites() gets buffered into one whole batch, so the throbber's
// frame-by-frame progress could never actually render (the visitor only ever saw
// thinking jump straight to the answer). The fix was streaming res.body straight
// through in app/src/app/api/v1/agent/turn/route.ts. If that ever regresses back to
// buffering, this read-throbber would never appear in time → the test goes red,
// catching it exactly.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';
// The reading-family verbs used by throbber-label.ts's corpus_read formatter.
const READ_VERBS = ['reading', 'pulling up', 'opening', 'checking', 'digging into'];

test.describe('throbber 在 DOM 里真显「reading <document>」', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-read-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-reading-dom spec',
    });
    await request.dispose();
  });

  test('corpus_read 进行中,DOM 显「<读类动词> <在读的 document>」',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Pure registration + ordered emission: corpus_search then corpus_read.
      // [[slow-final:2500]]: after read, hold for 2.5s, keeping the throbber
      // parked on reading X.
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag} [[slow-final:2500]]`);
      await input.press('Enter');

      // The read throbber shows up in the DOM (a single value, already replaced
      // search with read).
      const readThrobber = page.locator('[data-testid="tool-throbber-corpus_read"]');
      await expect(readThrobber).toBeVisible({ timeout: 15_000 });
      const label = (await readThrobber.innerText()).toLowerCase();

      // The label = a reading-family verb + the document being read (the
      // tree-derived path), not a dry, generic "retrieving".
      expect(READ_VERBS.some((v) => label.includes(v))).toBe(true);
      expect(label).toContain(TARGET_PATH); // specific to that parent_id tree-derived path

      // Mutual exclusion: at the moment a document is being read, the throbber has
      // only this one progress indicator, reading — the thinking one
      // (answer-pending) must not be present. (Past bug: reading and thinking both
      // rendered side by side, and what the visitor actually saw with their own
      // eyes was thinking.) Assert thinking is gone while the read throbber is
      // still up.
      await expect(readThrobber).toBeVisible();
      await expect(page.getByTestId('answer-pending')).toHaveCount(0);

      // The throbber clears once the turn lands (which also confirms it's truly
      // temporary).
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });
      await ctx.close();
    });
});
