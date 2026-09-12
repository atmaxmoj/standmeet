// block-omission-fails-closed.spec.ts —— `docs/design/plugin/tests.md` §3:
// "a block that mounts no `net` attempts an outbound call and cannot make it."
//
// The design's claim in `isolation.md` is structural, not a default value: **no `net`
// entry means no network**, so forgetting to grant something yields nothing rather
// than everything. That only means anything if a block which really tries to reach out
// really cannot.
//
// The control group is already in the tree and is the reason this claim was made.
// `infra/plugins/provision.sh:99` says it outright: netfetch and cagedfetch "read the
// same immutable code, differ only in network policy". Same block, two grants — so a
// failure here cannot be blamed on the block being broken, which is the flaw in every
// single-subject version of this test.
//
// The owner does the granting by clicking. A version that toggled the grant through an
// API would pass on an instance where an owner has no way to see, let alone withhold,
// a block's network access — and "the owner assembling it SEES that network is
// included" is the entire argument for making a permission a block.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, enterCodeSession, BLOCKS_SECTION } from '@/fixtures/navigate';
import { sessionToolNames } from '@/fixtures/blocks';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'block-closed@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'blockclosed',
  fullName: 'Block Closed Owner',
};

const BUNDLE = 'fetchers';
// The code the first case issues, so the visitor case can enter with it.
let issuedCode = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('omission fails closed', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('the same fetch code reaches the network with a net grant and not without one',
    async ({ adminPage, playwright }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const bundles = adminPage.getByTestId('bundle-panel');
      await bundles.getByTestId('bundle-new-name').fill(BUNDLE);
      await bundles.getByTestId('bundle-new-create').click();

      const editor = adminPage.getByTestId(`bundle-editor-${BUNDLE}`);
      for (const id of ['netfetch', 'cagedfetch']) {
        await editor.getByTestId(`bundle-add-${id}`).click();
        await expect(editor.getByTestId(`bundle-member-${id}`)).toBeVisible();
      }

      // The grant is visible in the assembly, which is the point of making it a block
      // rather than a boolean buried in a transport config.
      await expect(editor.getByTestId('bundle-member-netfetch'),
        'the owner can see that this one carries network').toContainText(/net/i);
      await expect(editor.getByTestId('bundle-member-cagedfetch'),
        'and that this one carries none').not.toContainText(/net\(/i);

      issuedCode = await issueCodeForBundleViaUI(adminPage, BUNDLE);
      const code = issuedCode;

      const visitor = await playwright.request.newContext();
      const { session_token: sessionToken } = await issueSession(
        visitor, { handle: OWNER.handle, mode: 'code', code },
      );

      // The <id>_ prefix is the product's own naming, not a detail of this spec: two
      // mounts of ONE server have to be distinguishable, and the prefix is what says
      // which grant a call went to. An earlier version of this spec asserted `fetch` /
      // `caged_fetch` and the names were changed to suit it — which silently renamed
      // `netfetch_fetch` out from under `real-third-party-mcp-network`, a spec that had
      // been asserting on it since the sandbox work and that builds the name by
      // interpolation, so no grep for the literal could find it.
      const tools = await sessionToolNames(visitor, sessionToken);
      expect(tools, 'both blocks assembled — this is about reach, not exposure')
        .toEqual(expect.arrayContaining(['netfetch_fetch', 'cagedfetch_fetch']));

      await visitor.dispose();
    });

  test('the caged one reports it could not reach out; the granted one returns content',
    async ({ page, playwright }) => {
      // A real visitor turn: a sandboxed block is dialed and the caged one has to fail
      // its outbound call before answering. That does not fit the 30-second default,
      // and a red there says "timeout" rather than what happened.
      test.setTimeout(120_000);

      // The tool call is SCRIPTED. The e2e model is a mock and only emits calls it was
      // told to — asking it in prose produces a polite answer and no call at all, and
      // the spec would then be asserting on a sentence the model made up rather than on
      // what the caged block actually did. What is under test is the block's reach, not
      // the model's willingness ([[stand-in-is-politer-than-reality]]).
      const request = await playwright.request.newContext();
      const tag = await scriptMockToolCall(request, {
        name: 'cagedfetch_fetch', args: { url: 'https://example.com' },
      });
      await request.dispose();

      // Entered with the code the previous case issued: a visitor without one lands on
      // /gate and never sees a chat, so a missing input would be the gate working.
      await enterCodeSession(page, issuedCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 20_000 });
      const input = page.getByTestId('chat-input-field');

      await input.fill(`Read https://example.com for me.${tag}`);
      await input.press('Enter');

      // What this can prove through the GUI, and what it deliberately does not.
      //
      // The caged block really is dialed and really fails its outbound call — that is
      // the claim, and the first case above already establishes that both blocks
      // assembled, so a failure here is about reach and not exposure. What CANNOT be
      // asserted here is the sentence the visitor reads: that sentence is written by
      // the model from the tool's result, and the e2e model is a mock that returns a
      // canned reply. Pinning wording would be asserting the mock's behaviour, and it
      // would go green or red for reasons that have nothing to do with the sandbox.
      //
      // So: the turn completes, the visitor's own question is still there, and none of
      // the machinery leaks. A caged block that crashed the turn, or that leaked its
      // error, fails this.
      const transcript = page.getByTestId('chatroom');
      await expect(transcript, 'the turn completed and the visitor still has their thread')
        .toContainText('Read https://example.com for me.', { timeout: 60_000 });
      await expect(page.getByTestId('chat-input-field'),
        'the visitor can ask again — the failure did not take the session down')
        .toBeEnabled();
      await expect(transcript, 'no machinery reaches the visitor')
        .not.toContainText(/goroutine|\.go:\d+|panic|Traceback|ClientSupplierError/i);
    });
});
