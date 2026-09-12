// block-failure-three-faces.spec.ts —— `docs/design/plugin/tests.md` §3:
// "tool absent from the list · the visitor gets an honest 'I can't' · the owner gets a
// persistent entry naming the block, with the child process's stderr."
//
// This is the rule from `block-model.md`: **outcome for the visitor, diagnosis for the
// owner.** The failure it replaces is real and was found live on 2026-09-08 — a plugin
// died at import, the backend logged "visitor block failed to bind — hidden from
// this session", and the owner was shown nothing at all. A block that silently is not
// there is indistinguishable from a block that was never installed.
//
// The third face is the one with teeth and the one nobody writes: the owner's entry
// must be **persistent** and must **name the block and carry the child's stderr**. A
// toast that appears if the owner happens to be looking is not a diagnosis, and
// "something went wrong" does not survive contact with a broken plugin.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, enterCodeSession, BLOCKS_SECTION } from '@/fixtures/navigate';
import { sessionToolNames } from '@/fixtures/blocks';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'block-3faces@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'block3faces',
  fullName: 'Block Faces Owner',
};

const BUNDLE = 'faces';
// The code the first case issues, so the visitor case can enter with it.
let issuedCode = '';

// A block whose command does not exist. Its stderr is the thing the owner must end up
// reading, so the failure has to come from a real spawn, not a stubbed error.
const BROKEN_ID = 'acme.broken.zzfixture';
const BROKEN_MANIFEST = `id: ${BROKEN_ID}
title: Acme Broken
version: "1"
shape: visitor_only
acl: role_granted
visitor_tools:
  - acme_broken_thing
transport:
  kind: stdio
  command: /nonexistent/acme-broken-server
`;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('failure has three faces', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('face 1 + 3: the tool is not offered, and the owner is told which block and why',
    async ({ adminPage, playwright }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const installer = adminPage.getByTestId('block-install-panel');
      await installer.getByTestId('block-manifest-input').fill(BROKEN_MANIFEST);
      await installer.getByTestId('block-install-submit').click();

      const bundles = adminPage.getByTestId('bundle-panel');
      await bundles.getByTestId('bundle-new-name').fill(BUNDLE);
      await bundles.getByTestId('bundle-new-create').click();
      const editor = adminPage.getByTestId(`bundle-editor-${BUNDLE}`);
      for (const id of ['corpus.retrieval', BROKEN_ID]) {
        await editor.getByTestId(`bundle-add-${id}`).click();
      }

      issuedCode = await issueCodeForBundleViaUI(adminPage, BUNDLE);
      const code = issuedCode;
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const visitor = await playwright.request.newContext();
      const { session_token: sessionToken } = await issueSession(
        visitor, { handle: OWNER.handle, mode: 'code', code },
      );

      // Face 1 — assembled contents, not "no error". The healthy block must still be
      // there, or this passes on a session that assembled nothing.
      const tools = await sessionToolNames(visitor, sessionToken);
      // Both halves, because either alone is satisfiable by the wrong outcome: without
      // the first, a session that assembled NOTHING would pass; without the second,
      // "the broken block was skipped" is never actually checked. `corpus.retrieval`
      // exposes a family of tools, so this names the one that must be there rather than
      // pinning the whole list — the claim is about which BLOCKS assembled.
      expect(tools, 'the healthy block still assembled')
        .toEqual(expect.arrayContaining(['corpus_search']));
      expect(tools, 'and the broken one contributed nothing')
        .not.toEqual(expect.arrayContaining(['acme_broken_thing']));
      await visitor.dispose();

      // Face 3 — a state on the bundle, still there on a fresh load, naming the block
      // and carrying what the child said before it died.
      await adminPage.reload();
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      const health = adminPage.getByTestId(`bundle-health-${BUNDLE}`);
      await expect(health, 'health is a state, not a toast').toBeVisible({ timeout: 10_000 });
      await expect(health, 'it says how many failed').toContainText(/1 block failed/i);

      const entry = health.getByTestId(`block-failure-${BROKEN_ID}`);
      await expect(entry, 'the entry names the block').toContainText('Acme Broken');
      await expect(entry, 'and carries the reason from the child, not a generic message')
        .toContainText(/no such file|not found|ENOENT/i);
    });

  test('face 2: the visitor is told what cannot happen, in their own terms',
    async ({ page, playwright }) => {
      // A real visitor turn, which does not fit the 30-second default; a red there
      // would say "timeout" rather than what the visitor was actually told.
      test.setTimeout(120_000);

      // The call is SCRIPTED: the e2e model is a mock and only emits calls it was told
      // to, so asking in prose produces a polite answer and no call — and the spec
      // would be reading a sentence the model invented rather than what the product
      // does when a visitor reaches for a block that could not start.
      const request = await playwright.request.newContext();
      const tag = await scriptMockToolCall(request, {
        name: 'acme_broken_thing', args: {},
      });
      await request.dispose();

      // Entered with the code the previous case issued: a visitor without one lands on
      // /gate and never sees a chat, so a missing input would be the gate working.
      await enterCodeSession(page, issuedCode);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 20_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`Please do the acme broken thing for me.${tag}`);
      await input.press('Enter');

      const transcript = page.getByTestId('chatroom');
      // An honest "I can't" — asserted positively, so the "never leaks" check below
      // cannot pass on a transcript that rendered nothing at all.
      await expect(transcript, 'honest about being unable')
        .toContainText(/can't|cannot|can not|not able|don't have|unable/i, { timeout: 30_000 });
      await expect(transcript, 'diagnosis belongs to the owner, not the visitor')
        .not.toContainText(new RegExp(`${BROKEN_ID}|nonexistent|ENOENT|goroutine`, 'i'));
    });
});
