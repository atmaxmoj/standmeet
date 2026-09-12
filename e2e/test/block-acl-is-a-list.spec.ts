// block-acl-is-a-list.spec.ts —— `docs/design/plugin/tests.md` §3:
// "the ACL answer is a list — 'what can this code do' is read, not simulated over
// three layers."
//
// Today answering that needs `global ∧ role ∧ ¬code-deny` evaluated against one
// process-wide registry, which is why it takes a design document and a matrix of specs
// to explain. Under the block model a code is bound to a bundle and the answer is the
// bundle's contents — so the claim is about what an owner can READ off one screen, and
// the only honest way to test it is to look at that screen.
//
// One thing this deliberately does not change, and the last case holds the line on:
// the owner's live off-switch. `block-disable-while-attached` proves
// `owner_enabled` is an independent gate that bites a running session. The one-sentence
// ACL rule is about GRANT and was never entitled to answer enablement; an earlier draft
// of the design collapsed the two and lost the owner's "installed but switched off"
// state entirely.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, BLOCKS_SECTION } from '@/fixtures/navigate';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';

const OWNER = {
  email: 'block-acl-list@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blockacllist',
  fullName: 'Block ACL Owner',
};

const BUNDLE = 'recruiter';
// The code the first case issues, kept so the later cases can find the same card.
// Assigned rather than derived: the fixture numbers codes per worker, and a spec that
// guessed the number would break the moment another case in the file issued one.
let CODE = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('what this code can do is a list, read not simulated', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('the code row shows its bundle, and the bundle shows its blocks',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      const bundles = adminPage.getByTestId('bundle-panel');
      await bundles.getByTestId('bundle-new-name').fill(BUNDLE);
      await bundles.getByTestId('bundle-new-create').click();

      const editor = adminPage.getByTestId(`bundle-editor-${BUNDLE}`);
      for (const id of ['corpus.retrieval', 'summarize_conversation']) {
        await editor.getByTestId(`bundle-add-${id}`).click();
      }

      CODE = await issueCodeForBundleViaUI(adminPage, BUNDLE);
      const row = adminPage.getByTestId(`code-card-${CODE}`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // The answer, on one screen, without opening three others.
      await expect(row, 'the code names the bundle it is bound to').toContainText(BUNDLE);
      await row.getByTestId('code-expand').click();
      const listed = row.getByTestId('code-block-list');
      await expect(listed).toBeVisible();
      await expect(listed.getByTestId('code-block-corpus.retrieval')).toBeVisible();
      await expect(listed.getByTestId('code-block-summarize_conversation')).toBeVisible();
    });

  test('editing the bundle moves every code bound to it — by reference, not by copy',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      await adminPage.getByTestId(`bundle-editor-${BUNDLE}`)
        .getByTestId('bundle-remove-summarize_conversation').click();

      await gotoAdminSection(adminPage, 'codes');
      const row = adminPage.getByTestId(`code-card-${CODE}`);
      await row.getByTestId('code-expand').click();

      const listed = row.getByTestId('code-block-list');
      await expect(listed.getByTestId('code-block-corpus.retrieval'),
        'the surviving block is still listed').toBeVisible();
      await expect(listed.getByTestId('code-block-summarize_conversation'),
        'no copy was taken when the code was issued').toHaveCount(0);
    });

  test('a block the owner switched off reads as present-and-off, never as absent',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);
      await adminPage.getByTestId('block-row-corpus.retrieval')
        .getByTestId('block-enabled-toggle').click();

      await gotoAdminSection(adminPage, 'codes');
      const row = adminPage.getByTestId(`code-card-${CODE}`);
      await row.getByTestId('code-expand').click();

      const entry = row.getByTestId('code-block-corpus.retrieval');
      await expect(entry, 'grant and enablement are different questions').toBeVisible();
      await expect(entry, 'the owner turned it off, and can see that he did')
        .toContainText(/off|disabled/i);
    });
});
