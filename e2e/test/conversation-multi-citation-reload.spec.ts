// conversation-multi-citation-reload.spec.ts — each turn's own citations must not cross-wire
// after a reload.
//
// Backend aggregation parses cited_* per assistant message, so "each dialog carries only its
// own citations" is an easy spot to get wrong (a careless implementation attaches every
// citation from the whole conversation to every message). This case guards it: two turns each
// cite a different doc → reload → each path's citation-row appears exactly once, each pointing
// at its own page.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

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

const CODE = 'MULTICITE-RELOAD-001';
const NAME = 'Mona';
const LUCERNA = 'projects/lucerna';
const FAMILY = 'personal/family';

test.describe('多轮各自引用,刷新后不串台', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'multicite-reload-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is my local-first knowledge tool.', title: 'Lucerna', path: LUCERNA,
    });
    await seedWiki(request, token, sid, {
      body: 'my mother is from singapore, my dad from BC.', title: 'Family', path: FAMILY,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('两轮各引一篇 → 刷新 → 每个 path 恰好 1 条 citation-row,各指各的', async ({ page }) => {
    await enterCodeSession(page, CODE, NAME);
    const input = page.getByTestId('chat-input-field');

    // Mock is pure registration: each turn's corpus_read is what cites its doc.
    const lucernaTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: LUCERNA },
    });
    await askAndRecord(page, input, `tell me about lucerna${lucernaTag}`);
    await expandRefsContaining(page, LUCERNA);
    await expect(rowFor(page, LUCERNA)).toBeVisible({ timeout: 20_000 });

    await expect(input).toBeEnabled({ timeout: 20_000 });
    const familyTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: FAMILY },
    });
    await askAndRecord(page, input, `tell me about your family${familyTag}`);
    await expandRefsContaining(page, FAMILY);
    await expect(rowFor(page, FAMILY)).toBeVisible({ timeout: 20_000 });

    // Reload → aggregation rebuilds the transcript. references collapse again; expand each one
    // then assert: each path appears exactly once (no cross-wiring), each pointing at its own
    // public page.
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expandRefsContaining(page, LUCERNA);
    await expandRefsContaining(page, FAMILY);

    await expect(rowFor(page, LUCERNA)).toHaveCount(1);
    await expect(rowFor(page, FAMILY)).toHaveCount(1);
    await expect(rowFor(page, LUCERNA)).toHaveAttribute('href', `/wiki/${LUCERNA}`);
    await expect(rowFor(page, FAMILY)).toHaveAttribute('href', `/wiki/${FAMILY}`);
  });
});

function rowFor(page: Page, path: string) {
  return page.locator(`[data-testid="citation-row"][data-citation-path="${path}"]`);
}

async function askAndRecord(
  page: Page, input: ReturnType<Page['getByTestId']>, q: string,
): Promise<void> {
  // #28: the backend persists to the DB at the end of the /agent/turn stream (right before
  // `done`); res.finished() = the stream has been fully read = it's already persisted. This SSE
  // barrier replaces the old wait for /dialogs to persist.
  const turnDone = page.waitForResponse((r) =>
    r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
  await input.fill(q);
  await input.press('Enter');
  await (await turnDone).finished();
}

// expandRefsContaining — references collapse by default; expands the details for the entry
// containing this path.
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs.first()).toBeVisible({ timeout: 20_000 });
  await refs.first().locator('summary').first().click();
}
