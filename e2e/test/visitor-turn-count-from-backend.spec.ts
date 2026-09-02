// visitor-turn-count-from-backend.spec.ts — the sole source of truth for the turn count is the
// backend conversation; the frontend's `used` in localStorage is only a cache. Once the two
// desync (e.g. the backend session was reset / the owner deleted the conversation, but the
// browser's localStorage still holds a stale used value), a reload must defer to what the
// backend actually counts — otherwise you get an inconsistency like "1/50 right from the start,
// with no question asked and not a single dialog visible."
//
// Expected: after a reload, the strip's used == the actual number of visitor turns in this
// backend conversation == the number of visible dialogs. Stale localStorage doesn't count.

import { test, expect } from '@/fixtures/test';

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

const CODE = 'COUNT-001';
const NAME = 'Frank';
const QUESTION = 'tell me about lucerna';
// The turn-count cell has its own testid (the member-count cell looks identical but **is not the
// same quantity** — with a shared class name, neither locator would point at the right one).
const USED_SEL = '[data-testid="session-strip-turns-used"]';

test.describe('turn 计数以后端 conversation 为唯一 source of truth', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'count-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('一进来没问 → used = 0(不是凭空 1)', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);
    await expect(page.locator(USED_SEL)).toHaveText('0', { timeout: 10_000 });
    await ctx.close();
  });

  test('stale localStorage used → reload 后以后端数出来的为准', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE, NAME);

    // Ask one question → the backend persists 1 visitor turn, the strip advances to 1. #28: it
    // persists at the end of the /agent/turn stream (right before `done`); res.finished() =
    // the stream has been fully read = it's already persisted.
    const turnDone = page.waitForResponse((r) =>
      r.url().includes('/agent/turn') && r.status() === 200, { timeout: 20_000 });
    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill(QUESTION);
    await input.press('Enter');
    await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
    await (await turnDone).finished();
    await expect(page.locator(USED_SEL)).toHaveText('1', { timeout: 10_000 });

    // Artificially corrupt localStorage's used value (simulating the client cache desyncing
    // from the backend).
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('standmeet-session');
      if (raw === null) throw new Error('no standmeet-session in localStorage');
      const parsed = JSON.parse(raw) as { used: number };
      parsed.used = 9;
      window.localStorage.setItem('standmeet-session', JSON.stringify(parsed));
    });

    // reload → the backend history rebuilds the transcript, and used must be corrected back to
    // what the backend actually counts (1), not left at the stale 9. The count == the number of
    // visible dialogs.
    await page.reload();
    await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(USED_SEL)).toHaveText('1', { timeout: 10_000 });

    await ctx.close();
  });

  test('别的访客占了名额 → reload 后 member_count 按后端纠回', async ({ browser }) => {
    const namesUsed = '[data-testid="session-strip-members-used"]';

    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();
    await enterCodeSession(page1, CODE, NAME);
    await expect(page1.locator(namesUsed)).toHaveText('1', { timeout: 10_000 });

    // A second visitor enters the same code with a different name → the backend's member_count
    // becomes 2. page1 has no idea.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await enterCodeSession(page2, CODE, 'Grace');

    // page1 reloads → the snapshot corrects member_count from the stale 1 to the backend's 2.
    await page1.reload();
    await expect(page1.locator(namesUsed)).toHaveText('2', { timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });
});
