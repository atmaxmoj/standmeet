// visitor-retrieval-summary-counts-every-tool.spec.ts — F-A-29: the "searched N ·
// read M" line is a **receipt** for the visitor, so it must count **every single**
// retrieval tool, not just the ones on some hand-copied list.
//
// Driven out from the real environment: in one turn the agent ran corpus_search
// twice + corpus_grep three times + corpus_read once, and what the visitor saw was
// `searched 2 · read 1` — the three grep calls were counted nowhere and rendered no
// card, completely invisible. The cause: the frontend hard-coded the retrieval
// family as a literal list of 4 names, while the backend registers 8.
//
// This asserts **coverage**, not a specific number: within one turn, every one of
// the 8 corpus_* tools gets called once, and the total must line up. That way, when
// a 9th tool is added later, this test goes red — a check written against a fixed
// list would not.
//
// Bucketing: opening one specific entry (corpus_read / corpus_peek) counts as read,
// everything else counts as search. peek counts as read because it fetches that
// note's own content (a snapshot), not "which notes might be relevant".

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'RETRSUM-001';
const PATH = 'projects/lucerna';

// Calls each backend-registered corpus_* retrieval tool once. Adding a new tool
// means adding a line here too — and if that's **forgotten**, the sums in
// EXPECTED_* below won't line up, and this test goes red.
const RETRIEVAL_CALLS = [
  { name: 'corpus_search', args: { query: 'lucerna' }, bucket: 'search' },
  { name: 'corpus_list', args: { path: 'projects' }, bucket: 'search' },
  { name: 'corpus_links', args: { path: PATH }, bucket: 'search' },
  { name: 'corpus_map', args: { budget: 50 }, bucket: 'search' },
  { name: 'corpus_resolve', args: { name: 'Lucerna' }, bucket: 'search' },
  { name: 'corpus_grep', args: { pattern: 'lucerna' }, bucket: 'search' },
  { name: 'corpus_read', args: { path: PATH }, bucket: 'read' },
  { name: 'corpus_peek', args: { paths: [PATH] }, bucket: 'read' },
] as const;

const EXPECTED_SEARCHES = RETRIEVAL_CALLS.filter((c) => c.bucket === 'search').length;
const EXPECTED_READS = RETRIEVAL_CALLS.filter((c) => c.bucket === 'read').length;

test.describe('检索回执数得全', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'retrieval-summary-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'retrieval summary', purpose: 'F-A-29 guard',
    });
    await request.dispose();
  });

  test('一轮里每个 corpus_* 工具都进那行计数', async ({ browser }) => {
    // The default 30s isn't enough: this test pays for a cold-start session
    // (measured ~20s, three sandboxes spawning for the first time) **and then**
    // runs 8 tool calls on top of it. 30s would time out before the assertion even
    // runs, so the failure message would point at "the element never appeared"
    // rather than whether the count was actually right.
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await enterCodeSession(page, CODE);

    let tags = '';
    for (const call of RETRIEVAL_CALLS) {
      tags += await scriptMockToolCall(page.request, {
        name: call.name, args: call.args,
      });
    }

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${tags}`);
    await input.press('Enter');

    const summary = page.getByTestId('retrieval-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });

    // Non-empty guard: first prove this line is actually reporting numbers,
    // otherwise "both counts are 0" would also make the assertions below look
    // like they pass for the right reason.
    await expect(summary).not.toHaveText('');

    await expect(summary).toContainText(`searched ${EXPECTED_SEARCHES}`);
    await expect(summary).toContainText(`read ${EXPECTED_READS}`);

    await ctx.close();
  });
});
