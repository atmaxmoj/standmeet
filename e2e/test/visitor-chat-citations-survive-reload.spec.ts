// visitor-chat-citations-survive-reload.spec.ts —— citations belong to the
// conversation aggregate, and must still be there after a reload.
//
// The backend already persists messages.cited_wiki_ids/cited_output_ids
// (RecordDialog writes them to the table), but GET /sessions/<conv>'s snapshot used to
// return only {question,answer}, dropping the citations — after a reload the
// transcript would rebuild as citations:[], and the references section would vanish.
// This guards: an answer arrives with citations → reload → citations are still there
// (the citation-row link still points at that doc).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'CITE-RELOAD-001';
const TARGET_PATH = 'projects/lucerna';

test.describe('引用属于会话聚合,刷新后仍在', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedCorpus(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('答复带引用 → reload → citation-row 仍在且指向该 doc', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, 'Cora');

    // Mock is pure registration: the corpus_read of lucerna is what cites it.
    const readTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: TARGET_PATH },
    });
    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${readTag}`);
    await input.press('Enter');
    // answer-body rendering = the `done` frame was received = the backend has already
    // sunk this turn (including cited_*) into the DB (persist happens before done), so
    // a reload after this point must see it. Since #28, citations are scraped by the
    // backend off the tail of the corpus_read stream itself, no longer relying on the
    // frontend's /dialogs.
    await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });

    // live: references are collapsed by default; expanded, the citation points at
    // /wiki/projects/lucerna.
    await expandRefsContaining(page, TARGET_PATH);
    const cite = page.locator(`[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`);
    await expect(cite).toBeVisible({ timeout: 20_000 });
    await expect(cite).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);

    // reload → the aggregate rebuilds the transcript, and citations must be parsed
    // back out of the backend's cited_* fields — they must not get lost.
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expandRefsContaining(page, TARGET_PATH);
    await expect(cite).toBeVisible({ timeout: 15_000 });
    await expect(cite).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);

    await ctx.close();
  });
});

// expandRefsContaining —— references are collapsed by default; expands the details
// element that contains the given path.
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs.first()).toBeVisible({ timeout: 20_000 });
  await refs.first().locator('summary').first().click();
}

async function seedCorpus(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cite-reload-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: TARGET_PATH,
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
}
