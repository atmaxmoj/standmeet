// block-unmount-is-immediate.spec.ts —— `docs/design/plugin/tests.md` §3:
// "removed from the bundle → the tool is uncallable at once; a call in flight fails."
//
// The decision this pins is in `block-model.md`: **no draining, no timeout, no
// asynchronous unmount.** Unmounted means the visitor has no ability to call it — not
// "will stop being offered to the next visitor", which is what a frozen-at-issue model
// gives and what an owner revoking access in a hurry would find useless.
//
// The owner's half is done by clicking, because "the owner removes a block" is only
// real if there is somewhere to remove it. The visitor's half reads the assembled
// toolset over the diagnostic GET; nothing here mutates through an API.
//
// Note what is NOT asserted: absence alone. A spec checking only "summarize is not in
// the list" also passes when the list failed to render. Every case asserts the
// surviving tool is still present, which is what makes the removal mean something.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, enterCodeSession, BLOCKS_SECTION } from '@/fixtures/navigate';
import { sessionToolNames } from '@/fixtures/blocks';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'block-unmount@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blockunmount',
  fullName: 'Block Unmount Owner',
};

const BUNDLE = 'recruiter';
// The code the first case issues, so the visitor case can enter with it.
let issuedCode = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('unmount is immediate', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  // A bundle with TWO blocks, so removing one leaves a witness. With a single block,
  // "the block is gone" and "the whole assembly broke" look identical from outside.
  test('assemble a bundle in the GUI, then take one block out mid-session',
    async ({ adminPage, playwright }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const bundles = adminPage.getByTestId('bundle-panel');
      // The section this panel lives in fetches the supplier catalog and list on
      // first paint; under a loaded machine that lands after five seconds. The
      // assertion is unchanged — a panel that never renders still fails — only the
      // patience is, so a red here means "no such panel" rather than "slow today".
      await expect(bundles, 'the owner has somewhere to assemble a bundle').toBeVisible({
        timeout: 20_000,
      });
      await bundles.getByTestId('bundle-new-name').fill(BUNDLE);
      await bundles.getByTestId('bundle-new-create').click();

      const editor = adminPage.getByTestId(`bundle-editor-${BUNDLE}`);
      await expect(editor).toBeVisible();
      for (const id of ['corpus.retrieval', 'summarize_conversation']) {
        await editor.getByTestId(`bundle-add-${id}`).click();
        await expect(editor.getByTestId(`bundle-member-${id}`)).toBeVisible();
      }

      issuedCode = await issueCodeForBundleViaUI(adminPage, BUNDLE);
      const code = issuedCode;
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const visitor = await playwright.request.newContext();
      const { session_token: sessionToken } = await issueSession(
        visitor, { handle: OWNER.handle, mode: 'code', code },
      );

      const before = await sessionToolNames(visitor, sessionToken);
      expect(before, 'both blocks assembled at session start')
        .toEqual(expect.arrayContaining(['corpus_search', 'summarize_conversation']));

      // The owner takes one out — by clicking, on the same page, while that session
      // is still open.
      await editor.getByTestId('bundle-remove-summarize_conversation').click();
      await expect(editor.getByTestId('bundle-member-summarize_conversation')).toHaveCount(0);

      // Immediate: the SAME session token, no re-issue, no reload.
      const after = await sessionToolNames(visitor, sessionToken);
      expect(after, 'the untouched block is still assembled')
        .toEqual(expect.arrayContaining(['corpus_search']));
      expect(after, 'the removed block is uncallable at once')
        .not.toEqual(expect.arrayContaining(['summarize_conversation']));

      await visitor.dispose();
    });

  test('the visitor is told an outcome, never a stack trace',
    async ({ page }) => {
      // Driven from the visitor's own page, entering with the code the previous case
      // issued: a visitor without one lands on /gate and never sees a chat at all, so
      // "the input is missing" would be the gate working rather than this failing.
      await enterCodeSession(page, issuedCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 15_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill('Please summarise this conversation for me.');
      await input.press('Enter');

      // A positive read first — there IS an answer — so the negative assertion below
      // cannot pass on an empty transcript ([[dont-write-absence-tests]]).
      const transcript = page.getByTestId('chatroom');
      await expect(transcript).toContainText(/\w/, { timeout: 30_000 });
      await expect(transcript, 'no Go path or panic ever reaches a visitor')
        .not.toContainText(/goroutine|\.go:\d+|panic/i);
    });
});
