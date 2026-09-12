// block-realm-per-session.spec.ts —— `docs/design/plugin/tests.md` §3:
// "two sessions run side by side, each seeing only its own tools; the registry is not
// copied."
//
// Both halves matter and they pull against each other. Per-session isolation is easy
// to get by giving every session a copy of everything — and that is exactly what not
// to do, because then an owner's edit reaches nobody and memory grows with visitors.
// One flat table, divergence at lookup.
//
// This claim has drawn blood once already. A Go-level test of realm isolation stayed
// GREEN while the isolation was broken, because duplicate providers resolved by
// registration order and the wrapper happened to be last; only a mutation found it. So
// the sessions here are opened and read **concurrently**: a table that is mutated per
// session and restored afterwards passes a sequential open/read/close and fails this.

import { test, expect } from '@/fixtures/test';

import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, BLOCKS_SECTION } from '@/fixtures/navigate';
import { sessionToolNames } from '@/fixtures/blocks';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';

/** Issue a code bound to `bundle` by clicking, and read the code off the screen.
 *
 *  A visitor enters with a code; the code is what carries the bundle. Doing this
 *  through the panel rather than a POST is the whole difference between testing the
 *  product and testing an API an owner cannot reach. */
async function issueCodeForBundle(adminPage: Page, bundle: string): Promise<string> {
  return issueCodeForBundleViaUI(adminPage, bundle);
}

const OWNER = {
  email: 'block-realm@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blockrealm',
  fullName: 'Block Realm Owner',
};

const WIDE = 'wide';
const NARROW = 'narrow';

/** Build one named bundle through the panel and confirm each block landed in it. */
async function seedBundle(adminPage: Page, id: string, blocks: readonly string[]) {
  const bundles = adminPage.getByTestId('bundle-panel');
  await bundles.getByTestId('bundle-new-name').fill(id);
  await bundles.getByTestId('bundle-new-create').click();
  const editor = adminPage.getByTestId(`bundle-editor-${id}`);
  await expect(editor).toBeVisible();
  for (const b of blocks) {
    await editor.getByTestId(`bundle-add-${b}`).click();
    await expect(editor.getByTestId(`bundle-member-${b}`)).toBeVisible();
  }
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('one realm per session', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('two live sessions each see their own toolset, and neither sees the other\'s',
    async ({ adminPage, playwright }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      await seedBundle(adminPage, WIDE, ['corpus.retrieval', 'summarize_conversation']);
      await seedBundle(adminPage, NARROW, ['corpus.retrieval']);

      const wideCode = await issueCodeForBundle(adminPage, WIDE);
      const narrowCode = await issueCodeForBundle(adminPage, NARROW);

      const a = await playwright.request.newContext();
      const b = await playwright.request.newContext();

      // Both opened before either is read.
      const [wide, narrow] = await Promise.all([
        issueSession(a, { handle: OWNER.handle, mode: 'code', code: wideCode }),
        issueSession(b, { handle: OWNER.handle, mode: 'code', code: narrowCode }),
      ]);
      const [wideTools, narrowTools] = await Promise.all([
        sessionToolNames(a, wide.session_token),
        sessionToolNames(b, narrow.session_token),
      ]);

      expect(wideTools, 'the wide session has both')
        .toEqual(expect.arrayContaining(['corpus_search', 'summarize_conversation']));
      expect(narrowTools, 'the narrow session still has its own')
        .toEqual(expect.arrayContaining(['corpus_search']));
      expect(narrowTools, 'and does not inherit the other realm')
        .not.toEqual(expect.arrayContaining(['summarize_conversation']));

      await a.dispose();
      await b.dispose();
    });

  test('the owner edits one bundle; only sessions on that bundle move',
    async ({ adminPage, playwright }) => {
      const wideCode = await issueCodeForBundle(adminPage, WIDE);
      const narrowCode = await issueCodeForBundle(adminPage, NARROW);

      const a = await playwright.request.newContext();
      const b = await playwright.request.newContext();
      const [wide, narrow] = await Promise.all([
        issueSession(a, { handle: OWNER.handle, mode: 'code', code: wideCode }),
        issueSession(b, { handle: OWNER.handle, mode: 'code', code: narrowCode }),
      ]);

      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      const editor = adminPage.getByTestId(`bundle-editor-${WIDE}`);
      await editor.getByTestId('bundle-remove-summarize_conversation').click();
      // The removal landed, checked where it was made. Without this the next read races
      // the write, and a session that still lists the block is indistinguishable from a
      // click that never took — the second being a defect in a different place
      // entirely ([[receipt-check-belongs-next-to-the-action]]).
      await expect(editor.getByTestId('bundle-member-summarize_conversation'),
        'the owner sees it leave the bundle').toHaveCount(0, { timeout: 10_000 });

      const [wideAfter, narrowAfter] = await Promise.all([
        sessionToolNames(a, wide.session_token),
        sessionToolNames(b, narrow.session_token),
      ]);

      // `corpus.retrieval` exposes a family of tools, so each check names the survivor
      // it needs rather than pinning the whole list. The pair is what carries the
      // claim: the edited realm lost summarize, the untouched one still has its own
      // block — a single "summarize is gone" would also pass on a session that
      // assembled nothing at all.
      expect(wideAfter, 'the edited bundle kept its other block')
        .toEqual(expect.arrayContaining(['corpus_search']));
      expect(wideAfter, 'and lost the one that was removed')
        .not.toEqual(expect.arrayContaining(['summarize_conversation']));
      expect(narrowAfter, 'the untouched bundle is unchanged')
        .toEqual(expect.arrayContaining(['corpus_search']));

      await a.dispose();
      await b.dispose();
    });
});
