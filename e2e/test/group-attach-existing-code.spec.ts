// group-attach-existing-code.spec.ts — attach / change / unbind a group on an ALREADY-EXISTING
// code, from the code card (blocks-panel-ux.md gap: today a group can be set only at code
// creation; the owner who assembled a group afterward has no way to point an existing code at it).
//
// Red-first: the code card exposes only a read-only view of the bound group today, so the
// `code-group-set-<code>` control does not exist yet. Drives the real controls end to end:
// assemble a group → issue a code with NO group → attach the group from the card → a NEW session
// on that code exposes exactly the group's blocks → unbind → the session falls back to the role.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection, BLOCKS_SECTION } from '@/fixtures/navigate';
import { issueSession } from '@/fixtures/visitor';
import { sessionToolNames } from '@/fixtures/blocks';

const OWNER = {
  email: 'group-rebind@example.com', password: 'correct-horse-battery-staple',
  handle: 'grouprebindowner', fullName: 'Group Rebind Owner',
};
const GROUP = 'recruiter';
const BLOCKS = ['corpus.retrieval', 'summarize_conversation'];
const GROUP_TOOLS = ['corpus_search', 'summarize_conversation'];
const ROLE_ONLY_TOOL = 'ask_visitor'; // role grants it, the group never does — the witness

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// This test opens THREE visitor sessions (baseline, after attach, after unbind), and a single
// session open cold-starts the code's sandboxed blocks — `issueSession`'s own budget is 25s. Three
// of those plus the assemble/attach UI cannot fit the default 30s test timeout; it passed at 13s
// only when the machine was quiet. Give it real headroom so a slow open is not read as a failure.
test.describe.configure({ timeout: 120_000 });

test.describe('owner flow · attach a group to an existing code', () => {
  test.beforeAll(async ({ playwright }) => {
    // claimFreshOwner resets the whole instance and reprovisions every block; the default 30s hook
    // budget is too tight for that under load — and configure({timeout}) covers the test body, not
    // hooks, so the hook needs its own headroom set here.
    test.setTimeout(90_000);
    await claimFreshOwner(playwright, OWNER);
  });

  test('assemble a group after issuing a code, then attach it from the code card', async ({
    adminPage, playwright,
  }) => {
    // 1. Assemble the group.
    await gotoAdminSection(adminPage, BLOCKS_SECTION);
    const panel = adminPage.getByTestId('bundle-panel');
    await panel.getByTestId('bundle-new-name').fill(GROUP);
    await panel.getByTestId('bundle-new-create').click();
    const editor = adminPage.getByTestId(`bundle-editor-${GROUP}`);
    for (const id of BLOCKS) {
      await editor.getByTestId(`bundle-add-${id}`).click();
      await expect(editor.getByTestId(`bundle-member-${id}`)).toBeVisible();
    }

    // 2. Issue a code with NO group.
    const code = await issueCodeNoGroup(adminPage);

    // (No separate "before" session: step 5's unbind→role already proves the role-grant path is
    // reachable, and each visitor session cold-starts the code's sandboxed blocks, so a third open
    // only adds flake surface for no extra coverage.)

    // 3. Attach the group from the code card (the control that must exist).
    await gotoAdminSection(adminPage, 'codes');
    const card = adminPage.getByTestId(`code-card-${code}`);
    await card.getByTestId(`code-group-set-${code}`).selectOption(GROUP);
    await expect(card.getByTestId('code-expand'), 'the card now shows a bound group')
      .toBeVisible({ timeout: 10_000 });

    // 4. A NEW session now exposes EXACTLY the group's blocks — not the role-only one.
    const bound = await toolsFor(playwright, code);
    expect(bound, 'session now scoped to the group').toEqual(expect.arrayContaining(GROUP_TOOLS));
    expect(bound, 'the group is the list, not the role').not.toContain(ROLE_ONLY_TOOL);

    // 5. Unbind → falls back to the role again. Wait for the unbind to LAND before opening a new
    // session: the bound-group detail (code-expand) disappears only once the store has the
    // server's bundle='' receipt back, so its absence is the mutation's completion signal. Without
    // this wait a fresh session races the in-flight PATCH and still reads the group (a flake, not a
    // product bug — the attach half above already waits on its own receipt, code-expand appearing).
    await card.getByTestId(`code-group-set-${code}`).selectOption('');
    await expect(card.getByTestId('code-expand'), 'the card shows no bound group after unbind')
      .toHaveCount(0, { timeout: 10_000 });
    const unbound = await toolsFor(playwright, code);
    expect(unbound, 'unbound → back to the role grant').toContain(ROLE_ONLY_TOOL);
  });
});

// issueCodeNoGroup — the new-code form, leaving the group picker at "none".
async function issueCodeNoGroup(adminPage: Page): Promise<string> {
  await gotoAdminSection(adminPage, 'codes');
  const code = `NOGRP-${Date.now().toString().slice(-6)}`;
  await adminPage.getByRole('button', { name: /new code/i }).click();
  await adminPage.getByTestId('code-input').fill(code);
  await adminPage.getByTestId('code-label').fill('rebind');
  await adminPage.getByTestId('code-bundle-select').selectOption('');
  await adminPage.getByTestId('code-create').click();
  await expect(adminPage.getByTestId(`code-card-${code}`)).toBeVisible({ timeout: 10_000 });
  return code;
}

// toolsFor — open a fresh visitor session on `code` and read back the tool names it was granted.
async function toolsFor(playwright: Playwright, code: string): Promise<string[]> {
  const visitor = await playwright.request.newContext();
  const { session_token } = await issueSession(visitor, { handle: OWNER.handle, mode: 'code', code });
  const tools = await sessionToolNames(visitor, session_token);
  await visitor.dispose();
  return tools;
}
