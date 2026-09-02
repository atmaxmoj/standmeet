// visitor-chat-thinking-rotation.spec.ts —— guards #10.
//
// During the stretches where the LLM is thinking (no specific tool running), the throbber
// must not show one static, dry "retrieving" — it rotates through a word list, picking a
// new word every 3 seconds (thinking-words.ts). This test verifies:
//   1. during a pure-thinking phase (no tool), the frontend shows the answer-pending line;
//   2. given enough time, the word changes (the rotation is real, not a single fixed word);
//   3. every word that appears comes from the **real word list** (not spinner text /
//      garbage / "retrieving").
//
// Same difficulty as reading-dom: the mock has zero latency, so nothing is observable by
// default. Fix: embed [[think:N]] in the question — the gateway skips every tool, sleeps N
// ms, then produces the answer; during that window no tool is running → the frontend keeps
// showing the thinking line, and if it's long enough the rotation can be observed. N=7000 →
// three words at 0s/3s/6s.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

// Mirrors THINKING_WORDS in app/src/lib/page/thinking-words.ts (drawn from thesaurus.com's
// ponder/contemplate/deliberate synonym group plus a compose branch). Keep this in sync
// when the word list changes.
const THINKING_WORDS = new Set([
  'thinking', 'considering', 'contemplating', 'deliberating', 'pondering',
  'reflecting', 'weighing', 'mulling', 'musing', 'reasoning', 'ruminating',
  'composing', 'drafting',
]);

test.describe('thinking 阶段 throbber 走词库轮换(非定死)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'thinking-rot-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'thinking-rotation spec',
    });
    await request.dispose();
  });

  test('纯思考阶段:词每 3 秒换、且都来自词库',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // [[think:7000]]: skip every tool, hold pure thinking for 7s (enough for words at
      // 0s/3s/6s).
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('just think about it [[think:7000]]');
      await input.press('Enter');

      const pending = page.locator('[data-testid="answer-pending"]');
      await expect(pending).toBeVisible({ timeout: 5_000 });

      // Sample the current word every ~250ms, dedupe, until at least 2 distinct words have
      // been seen (proving the rotation is real).
      const seen = await collectWords(pending);

      // 1) The rotation is real: at least 2 distinct words appeared.
      expect(seen.size).toBeGreaterThanOrEqual(2);
      // 2) Every word comes from the real word list (not "retrieving" / spinner / empty).
      for (const w of seen) {
        expect(THINKING_WORDS.has(w), `"${w}" 应来自 thinking 词库`).toBe(true);
      }

      await ctx.close();
    });
});

// collectWords — reads the current word from answer-pending roughly every 250ms (first
// token, trailing "· · ·" stripped), dedupes, until at least 2 distinct words have been seen
// (i.e. the rotation is observed). Uses expect.poll as the sampler: observable + honors
// spec.timeout, in line with the e2e no-sleep rule (no hand-rolled waitForTimeout).
// A retrying state shows "retrying" (not in the word list); the normal think path never
// retries.
async function collectWords(
  pending: ReturnType<Page['locator']>,
): Promise<Set<string>> {
  const seen = new Set<string>();
  await expect.poll(async () => {
    const raw = await pending.innerText().catch(() => '');
    const word = raw.split(/[·\n]/)[0]?.trim().toLowerCase() ?? '';
    if (word !== '') seen.add(word);
    return seen.size;
  }, { intervals: [250], timeout: 9_000 }).toBeGreaterThanOrEqual(2);
  return seen;
}
