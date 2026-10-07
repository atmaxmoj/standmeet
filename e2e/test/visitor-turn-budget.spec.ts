// visitor-turn-budget.spec.ts —— a visitor's turn gets a visitor-sized search budget (agent
// speedup W2).
//
// One budget of 24 rounds was sized for the owner crawling their own linked notes, and visitors
// shared it: on sijie.xyz "what are his weaknesses?" took 13 retrievals and 40–60 s before the
// first word. A visitor turn now gets 8 rounds; past that the turn ends through the same
// exhaustion path as before (forceFinalAnswer), which answers from the evidence gathered — it
// is not cut short, it is closed sooner.
//
// The model is scripted to keep searching (ten distinct queries). With a visitor budget the turn
// reaches the exhaustion synthesis, whose prompt carries a fixed nudge; the mock echoes the
// system prompt it received, so that nudge is visible in the answer.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'budget@example.com', password: 'visitor-budget-pass-1',
  handle: 'budget', fullName: 'Budget Owner',
};
const CODE = 'BUDGET-001';
const SEARCHES = 10;

test.describe('W2 · a visitor turn is closed after a visitor-sized search budget', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    await initOwner(playwright);
  });

  test('ten searches in a row: the turn closes with an answer from what it found',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await enterCodeSession(page, CODE, 'Reader');
      let tags = '';
      for (let i = 0; i < SEARCHES; i++) {
        tags += await scriptMockToolCall(request, {
          name: 'corpus_search', args: { query: `voice angle ${String(i)}` },
        });
      }
      await page.getByTestId('chat-input-field').fill(`tell me everything about voice ${tags}`);
      await page.getByTestId('chat-input-field').press('Enter');

      await expect(page.getByTestId('answer-body').last(),
        'the budget ran out before the ten searches did: the exhaustion synthesis answered')
        .toContainText('used your search budget for this turn', { timeout: 60_000 });
      await request.dispose();
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'budget-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, { body: 'voice intro.', title: 'Voice Intro' });
  await createCode(request, csrf, { code: CODE, label: 'Budget' });
  await request.dispose();
}
