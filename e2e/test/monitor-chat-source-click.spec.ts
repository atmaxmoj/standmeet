// monitor-chat-source-click.spec.ts —— the visitor opened one of the answer's sources.
//
// This is the event that closes the product's own loop: an AI answers in the owner's voice, cites
// the entries it drew from, and the visitor goes and reads one. "Which cited entry do people
// actually open" is a fact about the corpus that no other measurement produces — a chat turn
// happening says nothing about whether the grounding was worth reading.
//
// It is recorded on the `chat` surface wherever the citation appears, not on the page's surface.
// A citation row in the reader's chat rail and one in the chat room are the same interaction, and
// keying it on the page would file one gesture under two surfaces.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { readEvents } from '@/fixtures/monitor';
import type { MonitorEvent } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-source@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitorsource', fullName: 'Monitor Source',
};

const CODE = 'SOURCE-001';
const TARGET_PATH = 'projects/lucerna';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('monitor · opening a cited source is recorded', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'monitor-source-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool I built.',
      title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'source', purpose: 'monitor source-click spec',
    });
    await request.dispose();
  });

  test('clicking a citation emits source_click, naming the entry opened', async (
    { browser, request },
  ) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);

    const readTag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: TARGET_PATH },
    });
    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(`tell me about lucerna${readTag}`);
    await input.press('Enter');

    const citations = page.getByTestId('citations');
    await expect(citations).toBeVisible({ timeout: 30_000 });
    await citations.locator('summary').first().click();
    const row = page.locator(
      `[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`,
    );
    await expect(row).toBeVisible({ timeout: 10_000 });
    // The citation opens in a new tab, so the click both fires the listener and navigates away
    // from nothing. The listener runs in the capture phase for exactly this reason: by the time a
    // bubbled handler ran, the anchor's default action may already have taken the page.
    await row.click();

    const recorded = await sourceClick(request);
    expect(recorded, 'opening a cited source must be recorded').toBeTruthy();
    // Which entry. "A citation was clicked" is a number; "people open the lucerna note when it is
    // cited" is something the owner can act on.
    expect(recorded?.props['path']).toBe(TARGET_PATH);
    expect(recorded?.surface).toBe('chat');

    await ctx.close();
  });
});

// sourceClick —— the newest source_click row, waited for. sendBeacon is fire-and-forget: the
// click returns before the row exists, so a single read here would be a race that fails as
// "nothing was recorded".
async function sourceClick(request: APIRequestContext): Promise<MonitorEvent | undefined> {
  let found: MonitorEvent | undefined;
  await expect.poll(async () => {
    const rows = await readEvents(request, OWNER, {
      event: 'source_click', include_bots: true,
    });
    found = rows[0];
    return rows.length;
  }, { timeout: 15_000, intervals: [500] }).toBeGreaterThan(0);
  return found;
}
