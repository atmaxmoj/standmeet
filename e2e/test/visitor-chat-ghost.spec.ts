// visitor-chat-ghost.spec.ts — Ghost steering P4: **a single** ghost-text in the input field
// (one candidate, replacing the old multi-queue + Esc cycle + 3 followups per turn).
//
// The single-ghost design ([[ghost-steering]] "one ghost beats three"):
//   1. a code visitor enters chat → the input shows **one** ghost (initial = the first entry in
//      code.ghosts)
//   2. Tab → fills into the input (does not auto-send)
//   3. Esc **no longer cycles** (there's no second candidate to switch to; it's a single one)
//   4. after answering a turn → policy sends a **singular** `ghost` frame → the input's ghost
//      switches to that policy one (steered by target_waypoint)
//   5. the admin transcript modal shows a "shown" log entry, source ∈ {initial, policy}, accepted
//      follows the Tab
//
// RED (before implementation): the store is still multi-queue with cycling, the backend still
// sends the old `ghosts` frame (3 entries) → the single-candidate assertions go red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockGhost } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ghost-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostowner',
  fullName: 'Ghost Owner',
};
const CODE = 'GHOST-001';

// code.ghosts still provides the static starter phrases (the suggested questions on the QR/
// landing page), but the input field's ghost-text now **only takes the first entry** as the
// single initial ghost — it no longer seeds the whole queue, and no longer cycles.
const GHOSTS = [
  'What did you ship last quarter?',
  'Why are you considering a move?',
];
const INITIAL = GHOSTS[0]!;

const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};
const POLICY_GHOST = {
  text: 'What made you take on Alpha?',
  target_waypoint: 'grasp-alpha',
  follows_from: 'you mentioned Alpha',
  is_bridge: false,
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor chat ghost text · 单个 · P4', () => {
  test('code visitor → 输入框显示单条 ghost(initial);Tab 填进 input', async ({ page }) => {
    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input, 'ghost = code.ghosts 首条(单个 initial)')
      .toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.focus();
    await input.press('Tab');
    await expect(input, 'Tab 填进 input(不 submit)').toHaveValue(INITIAL);
  });

  test('Esc 不再 cycle(单个,没有第二条可切)', async ({ page }) => {
    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input).toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.focus();
    await input.press('Escape');
    // Single-candidate: after Esc the ghost should not become GHOSTS[1] (the old behavior was
    // cycling to the second entry).
    await expect(input, 'Esc 后仍是首条(无 cycle)').not.toHaveAttribute('data-ghost', GHOSTS[1]!);
  });

  test('答完一轮 → 输入框 ghost 换成 policy 单条(不是 3 条 followup)', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const ghostTag = await scriptMockGhost(req, POLICY_GHOST);
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input).toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.fill(`tell me about your work${ghostTag}`);
    await input.press('Enter');
    await expect(page.getByTestId('answer-body')).toBeVisible({ timeout: 20_000 });

    await expect(input, '答完 → policy ghost(单数,target_waypoint 引导)')
      .toHaveAttribute('data-ghost', POLICY_GHOST.text, { timeout: 10_000 });
  });

  // F-A-9: on a turn where policy stays silent (no ghost frame comes out) → the previous
  // steering ghost must be cleared (without relying on a reload).
  // RED (before the fix): on a frame-less turn, the client didn't clear the ghost, and the
  // input kept holding onto POLICY_GHOST.text.
  test('policy 沉默的一轮 → 陈旧 ghost 被清成空(不 reload)', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const ghostTag = await scriptMockGhost(req, POLICY_GHOST);
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input).toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });

    // Turn 1: with the tag → policy produces a ghost → the input switches to the policy ghost.
    await input.fill(`tell me about Alpha${ghostTag}`);
    await input.press('Enter');
    await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 20_000 });
    await expect(input).toHaveAttribute('data-ghost', POLICY_GHOST.text, { timeout: 10_000 });

    // Turn 2: without the tag → policy stays silent (unscripted defaults to null) → the stale
    // ghost must be cleared to ''.
    await input.fill('and what else');
    await input.press('Enter');
    await expect(page.getByTestId('answer-body')).toHaveCount(2, { timeout: 20_000 });
    await expect(input, 'silent turn → ghost cleared (RED: stays POLICY_GHOST.text)')
      .toHaveAttribute('data-ghost', '', { timeout: 10_000 });
  });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // The WP's evidence note has to genuinely exist — only once feasibility clears that floor at
  // freeze time does the entry get admitted into the snapshot (F-A-26).
  const apiToken = await createAPIToken(request, csrf, 'ghost-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, { title: 'Alpha', body: 'Alpha.', path: 'alpha' });
  const role = await createRole(request, csrf, {
    name: 'ghost-role', description: 'ghost spec',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'ghost', assumed_role_id: role.id, ghosts: GHOSTS,
  });
  await request.dispose();
}
