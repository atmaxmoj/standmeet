// visitor-cited-doc-viewable.spec.ts — a visitor holding a code clicks a citation →
// navigates to that document's page → must be able to see the full text, not a
// "requires an access code" lock screen.
//
// Reasoning: a visitor logged in with a code, whose role ACL grants this entry (the
// AI is answering by having read it with exactly this access), obviously should be
// able to view it. The public landing page is published-only and does not recognize
// a session, so a cited document that isn't indexed falls back to the lock screen —
// that's the bug. The fix: the lock-screen client fetches the full text using the
// visitor's session through corpus_read (which evaluates ACL) and renders it.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';
const TARGET_BODY = 'lucerna is a local-first knowledge tool I built.';

test.describe('持 code 访客点引用 → 看得到被引文档(不落锁屏)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cited-doc-seed');
    const sid = await initMCP(request, token);
    // published is left unset → the public landing page will lock it; but the
    // visitor's code/ACL should let them through.
    await seedWiki(request, token, sid, {
      body: TARGET_BODY, title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, { code: CODE, label: 'intro' });
    await request.dispose();
  });

  test('访客起会后直接开 /wiki/<被引 path> → 显全文,非锁屏',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Starting a session = a visitor session (token + conversation_id) lands in
      // localStorage.
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Simulate clicking a citation: in the same context (with the session in
      // localStorage), open that doc's public URL.
      await goto(page, `/wiki/${TARGET_PATH}`);

      // The full text is fetched and rendered via the session — wiki-body appears
      // and contains the original text, and the lock screen is absent.
      await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('wiki-body')).toContainText(TARGET_BODY);
      await expect(page.getByText('This entry requires an access code')).toHaveCount(0);

      await ctx.close();
    });
});
