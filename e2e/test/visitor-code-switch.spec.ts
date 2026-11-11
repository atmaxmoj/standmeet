// visitor-code-switch.spec.ts —— a visitor already in a LIVE coded chat who opens a DIFFERENT ?code=
// must SWITCH to it, not stay in the old chat (spec 2026-11-10: "presenting a second access code must
// switch the session"). Presenting the new code auto-switches — a brief "switching" notice, then the
// new code is the active session — carrying the same identity; it does not sit on an "access granted"
// form while the old session stays active.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'code-switch@example.com', password: 'correct-horse-battery-staple',
  handle: 'codeswitch', fullName: 'Code Switch Owner',
};
const CODE_A = 'SWITCH-AAA1';
const CODE_B = 'SWITCH-BBB2';
const NAME = 'Recruiter Rhea';

test.describe('visitor · a different ?code= while in a live chat offers the switch', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('in a live A-session, opening ?code=B switches to B — not kept in the old A chat',
    async ({ page }) => {
      test.setTimeout(90_000);
      // Land in a LIVE session for code A: open ?code=A → pick a name → a usable chat.
      await enterCodeSession(page, CODE_A, NAME);
      await expect(page.getByTestId('chat-input-field'), 'A is a live, usable session')
        .toBeEnabled({ timeout: 20_000 });
      await expect(page.getByTestId('session-strip'), 'in on A').toContainText(CODE_A, { timeout: 10_000 });

      // Open a DIFFERENT code while in that live session → it must switch to B, not keep A.
      await openReader(page, `/?code=${CODE_B}`);
      await expect(page.getByTestId('session-strip'), 'switched to B')
        .toContainText(CODE_B, { timeout: 20_000 });
      await expect(page.getByTestId('session-strip'), 'no A label remains').not.toContainText(CODE_A);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'switch-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, { body: 'switch intro.', title: 'Switch Intro' });
  await createCode(request, csrf, { code: CODE_A, label: 'Link A', max_turns_per_session: 50, max_members: 10 });
  await createCode(request, csrf, { code: CODE_B, label: 'Link B', max_turns_per_session: 50, max_members: 10 });
  await request.dispose();
}
