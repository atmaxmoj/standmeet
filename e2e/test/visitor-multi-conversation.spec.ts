// visitor-multi-conversation.spec.ts — redefines the visitor conversation model.
//
// Old model: one name = one continuous conversation, with every surface sharing the same
// conversation_id.
// New model (the target this spec pins down):
//   - One member (name) can have **multiple conversations**: one on the main page +
//     one in each doc's floating dock;
//   - These transcripts are **independent of each other** — the dock no longer
//     inherits/clones the main chat's transcript;
//   - But the turn quota is **member-level** — all conversations burn from one shared
//     budget.
//
// "Cross-pollination" (the AI being able to read all of that member's conversations) is
// S3's eval/plumbing coverage, not this spec's concern.
//
// This is guaranteed to run red right now: the implementation hasn't yet split apart
// "every surface shares one conversation". This is the test-first target state.

import { test, expect } from '@/fixtures/test';
import type { Playwright, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedPublicWiki, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'multiconv-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'multiconv',
  fullName: 'Multi Conv Owner',
};

const SEP_CODE = 'MULTICONV-1';    // unlimited turns, verifies "conversations are independent"
const BUDGET_CODE = 'MULTIBUDGET-1'; // max_turns=2, verifies "quota is shared across conversations"

test.describe('visitor multi-conversation model', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('floating dock is a SEPARATE conversation from the main chat',
    async ({ page }) => {
      await enterCodeSession(page, SEP_CODE);
      await askMain(page, 'main page question');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      // The dock's conversation is new and independent — it does not inherit the main
      // chat's transcript.
      await expect(panel.getByTestId('answer-body')).toHaveCount(0);

      await askDock(page, 'dock-only question');
      await expect(panel.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      // Back to the main page -> the main conversation is still there (1 message), and
      // doesn't include the dock one.
      await goto(page, '/');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
    });

  test('互通 plumbing: the dock turn carries the main chat into its instruction',
    async ({ page }) => {
      await enterCodeSession(page, SEP_CODE);
      await askMain(page, 'please remember the codeword ZEBRA-PLUMBING-9137');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      await askDock(page, 'what did I tell you earlier?');
      // The mock gateway echoes back the system/instruction verbatim ([system:…]). The
      // backend's "cross-pollination" injects that member's **main conversation** into
      // the dock turn's instruction, so the dock's answer (the echo) should contain the
      // codeword from the main conversation — a deterministic proof that the backend
      // really injected it, not just an eval judging quality.
      await expect(panel.getByTestId('answer-body'))
        .toContainText('ZEBRA-PLUMBING-9137', { timeout: 15_000 });
    });

  test('turn budget is shared across the member\'s conversations',
    async ({ page }) => {
      await enterCodeSession(page, BUDGET_CODE); // budget of 2
      await askMain(page, 'budget turn 1');       // turn 1 (main conversation)
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      await askDock(page, 'budget turn 2');        // turn 2 (the dock conversation — member total reaches 2)
      await expect(panel.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
      // answer-body appears as soon as the answer "starts streaming", but the optimistic
      // +1 (incUsed) only lands at that turn's **finalization**. Wait for the progress
      // row to disappear = finalization complete -> used hits the ceiling, then assert
      // the lock — never give disable an arbitrary wall-clock window (the lock should be
      // immediate; if it's still unlocked after finalization, that's a real bug, not
      // slowness).
      await expect(panel.getByTestId('chat-progress')).toHaveCount(0, { timeout: 15_000 });
      // Burning through turn 2 in the dock exhausts the member's budget (2) — used is a
      // member-level shared value, so it locks immediately.
      await expect(panel.getByTestId('floating-chat-input')).toBeDisabled();

      // Back to the main page: once restore lands (the main conversation's 1 turn
      // reappears, and the same VisitorView sets used to 2), the main composer is also
      // locked by that same shared used value — consistent across surfaces.
      await goto(page, '/');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByTestId('chat-input-field')).toBeDisabled();
    });
});

async function askMain(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(text);
  await input.press('Enter');
}

// openDock — opens the floating dock on a real doc page (/wiki/projects/lucerna, which
// carries docContext). The dock routing to its own per-doc conversation only happens on a
// real doc page; the /writings index page has no docContext, so its dock falls back to
// the main conversation (that's expected — an index isn't an article).
async function openDock(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await goto(page, '/wiki/projects/lucerna');
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('floating-dock-pill').click();
  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });
  return panel;
}

async function askDock(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('floating-chat-input');
  await input.fill(text);
  await input.press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'multiconv-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, { body: 'owner intro.', title: 'Intro' });
  // An indexed wiki doc so /wiki/projects/lucerna's landing page can render (only on
  // top of it does the dock get docContext -> routes to its own conversation).
  const luc = await seedWiki(request, apiToken, sid, {
    body: 'lucerna is a local-first knowledge tool.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await publishEntry(request, apiToken, sid, {
    genre: 'wiki', id: luc.wikiID, excerpt: 'a local-first knowledge tool',
  });
  await createCode(request, csrf, { code: SEP_CODE, label: 'Separation test' });
  await createCode(request, csrf, {
    code: BUDGET_CODE, label: 'Shared budget test', max_turns_per_session: 2,
  });
  await request.dispose();
}
