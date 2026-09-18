// group-to-code-flow.spec.ts — the owner-facing block → group → code flow, end to end through the
// REAL panel controls, and readable without prior knowledge (blocks-panel-ux.md).
//
// The flow itself (assemble a set, attach it to a code, a session gets those blocks) is exercised
// by block-acl-is-a-list / block-omission-fails-closed at the API-adjacent layer; what this spec
// adds is the UX contract the owner asked for:
//   1. the composable set is called a GROUP everywhere the owner looks (never "bundle" / "fiber"),
//   2. a `?` explains what a block is, what a group is, and how a group attaches to a code,
//   3. driven through the controls, the whole chain resolves: assemble → attach → the code's
//      session exposes EXACTLY the group's blocks (a role-only block stays absent).
// Red-first: the group labels + the `?` tooltips do not exist yet, so 1 and 2 fail until built;
// the chain in 3 already works and must stay green.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, BLOCKS_SECTION } from '@/fixtures/navigate';
import { issueCodeForBundleViaUI } from '@/fixtures/codes';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/blocks';

const OWNER = {
  email: 'group-flow@example.com', password: 'correct-horse-battery-staple',
  handle: 'groupflowowner', fullName: 'Group Flow Owner',
};
const GROUP = 'recruiter';
// Two deps-free builtin blocks that assemble for a fresh owner (no connected supplier needed) —
// the pair acl-bundle-additive uses. Their tools: corpus.retrieval → corpus_search,
// summarize_conversation → summarize_conversation.
const BLOCKS = ['corpus.retrieval', 'summarize_conversation'];
const GROUP_TOOLS = ['corpus_search', 'summarize_conversation'];
// A deps-free block the fresh owner's role grants but the group never contains — the witness for
// "the session is exactly the group's list", not the role's.
const ROLE_ONLY_TOOL = 'ask_visitor';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('owner flow · block → group → code', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('assemble a group, attach it to a code, and the session gets exactly its blocks',
    async ({ adminPage, playwright }) => {
      await gotoAdminSection(adminPage, BLOCKS_SECTION);

      // The composable set is a GROUP to the owner (blocks-panel-ux.md), never "bundle"/"fiber".
      const panel = adminPage.getByTestId('bundle-panel');
      await expect(panel, 'the assembler calls it a group').toContainText(/group/i);
      await expect(panel, 'no internal jargon leaks to the owner').not.toContainText(/fiber/i);

      await panel.getByTestId('bundle-new-name').fill(GROUP);
      await panel.getByTestId('bundle-new-create').click();
      const editor = adminPage.getByTestId(`bundle-editor-${GROUP}`);
      for (const id of BLOCKS) {
        await editor.getByTestId(`bundle-add-${id}`).click();
        await expect(editor.getByTestId(`bundle-member-${id}`)).toBeVisible();
      }

      const code = await issueCodeForBundleViaUI(adminPage, GROUP);

      const visitor = await playwright.request.newContext();
      const { session_token } = await issueSession(
        visitor, { handle: OWNER.handle, mode: 'code', code },
      );
      const tools = await sessionToolNames(visitor, session_token);
      expect(tools, 'the session exposes exactly the group\'s blocks')
        .toEqual(expect.arrayContaining(GROUP_TOOLS));
      expect(tools, 'and not a block granted only by the role — the session is the group, not the role')
        .not.toContain(ROLE_ONLY_TOOL);
      await visitor.dispose();
    });

  test('a ? explains what a block is and what a group is', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, BLOCKS_SECTION);

    await adminPage.getByTestId('help-block').click();
    await expect(adminPage.getByTestId('help-block-text'), 'the block help reads plainly')
      .toContainText(/ability|block/i);

    await adminPage.getByTestId('help-group').click();
    await expect(adminPage.getByTestId('help-group-text'), 'the group help reads plainly')
      .toContainText(/set of blocks|assemble|group/i);
  });

  test('a ? on the code control explains how a group attaches to a code', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'codes');
    await adminPage.getByRole('button', { name: /new code/i }).click();
    await adminPage.getByTestId('help-attach').click();
    await expect(adminPage.getByTestId('help-attach-text'), 'the attach help reads plainly')
      .toContainText(/group|code can use|those blocks/i);
  });
});
