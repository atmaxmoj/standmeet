// coded-visitor-can-converse.spec.ts —— a recruiter who opens the product's own link (?code=<valid>)
// must be able to actually START A CONVERSATION. This is the positive capability the coded landing
// exists for — not "the name picker appears" (too shallow — coded-link-opens-chat stops there and
// stayed green while the landing rendered a "page under construction" background), and not "the
// under-construction text is absent" (asserting a negative). The owner's rule: assert you can begin
// talking.
//
// Drives the whole front-door path: open the coded link → pick a name → send a message → the AI
// answers in the transcript. RED if the landing can't carry a visitor through to a live turn.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'converse@example.com', password: 'correct-horse-battery-staple',
  handle: 'converseowner', fullName: 'Converse Owner',
};
const CODE = 'CONV-RECRUIT1';
const NAME = 'Recruiter Rhea';
const REPLY = 'Yes — here is the answer in their voice.';

test.describe('coded visitor can start a conversation', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('open ?code= → pick a name → send a message → the AI answers', async ({ page }) => {
    test.setTimeout(60_000);
    await enterCodeSession(page, CODE, NAME);

    // The chat is ready to use — an input the visitor can type into (not a "under construction" page).
    const input = page.getByTestId('chat-input-field');
    await expect(input, 'the coded visitor lands in a usable chat').toBeEnabled({ timeout: 20_000 });

    // Send a real turn; the mock returns the registered reply, so a green here means the whole
    // landing → session → agent-turn → transcript path worked.
    const tag = await scriptMockReplyText(page.request, REPLY);
    const turnDone = page.waitForResponse(
      (r) => r.url().includes('/agent/turn') && r.status() === 200, { timeout: 30_000 });
    await input.fill(`hello, are you there${tag}`);
    await input.press('Enter');
    await (await turnDone).finished();

    await expect(page.getByTestId('answer-body').last(),
      'the AI answered — the conversation started').toContainText(REPLY, { timeout: 20_000 });
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'converse-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, { body: 'converse intro.', title: 'Converse Intro' });
  await createCode(request, csrf, { code: CODE, label: 'Recruiter link', max_turns_per_session: 50, max_members: 10 });
  await request.dispose();
}
