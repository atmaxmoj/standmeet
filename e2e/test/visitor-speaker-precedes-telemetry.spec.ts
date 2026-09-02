// visitor-speaker-precedes-telemetry.spec.ts — UX-31: within one answer turn, "who is
// speaking" must appear before "how many retrievals this turn made".
//
// Found in design review (not by driving Steps): the real-environment reading order
// is `YOU → question → SEARCHED 2 · READ 5 → AI → answer` — the eye hits a line of
// machine statistics before it even knows who's speaking, while this product's
// entire thesis is "the AI answers in the owner's voice". Traced to
// `ChatTranscript.tsx`: `ToolCallCards` is ordered before `AnswerView`.
//
// What's asserted is **geometry**, not DOM order: what the reader sees is which one
// sits above the other on screen. Coming first in the DOM but pushed down by CSS is
// just as broken (this round has already paid once for "a text assertion can't see
// layout", see F-A-25).

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

const CODE = 'SPEAKER-001';

test.describe('the speaker label comes before the turn telemetry', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'speaker-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, { code: CODE, label: 'speaker', purpose: 'UX-31 guard' });
    await request.dispose();
  });

  test('AI label sits above the searched/read line, not below it', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);

    // Only a turn with retrieval produces that telemetry line — without it, this
    // assertion has nothing to compare against (a vacuous pass on an empty set).
    const searchTag = await scriptMockToolCall(page.request, {
      name: 'corpus_search', args: { query: 'lucerna' },
    });
    const readTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: 'projects/lucerna' },
    });

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${searchTag}${readTag}`);
    await input.press('Enter');

    const speaker = page.getByTestId('answer-speaker');
    const telemetry = page.getByTestId('retrieval-summary');
    await expect(speaker).toBeVisible({ timeout: 30_000 });
    await expect(telemetry).toBeVisible({ timeout: 30_000 });

    const speakerBox = await speaker.boundingBox();
    const telemetryBox = await telemetry.boundingBox();
    expect(speakerBox, 'speaker label must be laid out').not.toBeNull();
    expect(telemetryBox, 'telemetry line must be laid out').not.toBeNull();
    // Who is speaking must be seen first.
    expect(speakerBox!.y).toBeLessThan(telemetryBox!.y);

    await ctx.close();
  });
});
