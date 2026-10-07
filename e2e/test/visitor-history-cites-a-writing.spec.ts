// visitor-history-cites-a-writing.spec.ts —— a visitor's conversation comes back when one of its
// answers cited a writing (an essay), not only wiki/output.
//
// sijie.xyz, 2026-10-07 (owner: "我的记录怎么丢了？作为访客，我的同一个码，怎么找我的历史"): the
// visitor re-entered with the same code and name; the backend resumed their conversation and
// returned all five turns, but the room showed only its welcome. One answer had cited a writing; the
// page's check on the restored conversation allowed only `wiki | output` citations, so one citation
// it did not know threw the whole conversation away, silently.
//
// Asserted: after a reload the earlier question is on screen, and its writing citation links to the
// essay's public page.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'history-writing@example.com', password: 'correct-horse-battery-staple',
  handle: 'historywriting', fullName: 'History Writing Owner',
};
const CODE = 'HISTWRITE-1';
const SLUG = 'context-is-the-bug';
const QUESTION = 'what take do you hold that peers disagree with';

test.describe('a conversation that cited a writing comes back', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'history-writing-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'writing_create', {
      slug: SLUG, title: 'Context is the bug', excerpt: 'x',
      body_md: 'Bad AI writing is a context bug, not the model.', tags: [], publish: true,
    });
    // The default (invited) role reads writing://**.
    await createCode(request, csrf, { code: CODE, label: 'history writing', max_turns_per_session: 20 });
    await request.dispose();
  });

  test('reload → the earlier Q&A is there, with its writing citation', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, 'Gus');
    const readTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: `writings/${SLUG}` },
    });
    const turnDone = page.waitForResponse((r) =>
      r.url().includes('/agent/turn') && r.status() === 200, { timeout: 30_000 });
    const input = page.getByTestId('chat-input-field');
    await input.fill(`${QUESTION}${readTag}`);
    await input.press('Enter');
    await expect(page.getByTestId('citation-genre-writing'), 'the live answer cites the writing')
      .toHaveCount(1, { timeout: 30_000 });
    await (await turnDone).finished();

    await page.reload();
    await expect(page.getByText(QUESTION), 'the earlier question comes back').toBeVisible({ timeout: 20_000 });
    const row = page.getByTestId('citation-row').filter({ has: page.getByTestId('citation-genre-writing') });
    await expect(row).toHaveAttribute('href', `/writings/${SLUG}`);
    await ctx.close();
  });
});
