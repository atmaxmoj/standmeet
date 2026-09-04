// conversation-toolcalls-survive-reload.spec.ts —— tool calls are part of the
// conversation and must still be there after a reload (owner reviewing / visitor resuming both need to see what the AI searched).
//
// Since #28 the backend owns this turn: at the end of the /agent/turn stream it sinks tool_calls into
// messages.tool_calls (before the `done` frame → committed by the time the answer is visible). This guards: a reply
// used a tool → reload → the aggregation rebuilds from the backend tool_calls → the SEARCHED card is still there.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'TOOLCALL-RELOAD-001';
const NAME = 'Tara';

test.describe('tool 调用属于会话,刷新后仍在', () => {
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

  test('答复用过 corpus_search → reload → SEARCHED 卡仍在', async ({ page }) => {
    await enterCodeSession(page, CODE, NAME);

    // Pure registration: the SEARCHED card renders from a corpus_search tool call.
    const searchTag = await scriptMockToolCall(page.request, {
      name: 'corpus_search', args: { query: 'lucerna' },
    });
    const input = page.getByTestId('chat-input-field');
    await input.fill(`tell me about lucerna${searchTag}`);
    await input.press('Enter');

    // live: the collapsed retrieval-summary (UX-10) appears. answer-body rendered = `done`
    // frame received = the backend has sunk this turn (including tool_calls) into the DB (persist before done),
    // so a reload after this must see it.
    const summary = page.getByTestId('retrieval-summary');
    await expect(summary).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('answer-body')).toBeVisible({ timeout: 20_000 });

    // reload → the aggregation rebuilds the transcript; the retrieval row must be restored from the backend tool_calls, not lost.
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('retrieval-summary')).toBeVisible({ timeout: 15_000 });
  });
});

async function seedCorpus(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'toolcall-reload-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
}
