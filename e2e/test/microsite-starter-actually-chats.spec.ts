// microsite-starter-actually-chats.spec.ts -- the starter template the panel hands out
// must be **something that actually runs**.
//
// Bug (2026-08-30, the owner found this themselves in the product): "I wanted to wire in our
// chat feature and had no idea what to write." The panel offers just a slug field + a
// textarea, and the starter template is literally `<main><h1>Hello</h1></main>`.
//
// Yet `builder/vendor/` **already** has `@standmeet/sdk` / `sdk-core` / `agent-core`
// installed; chat can be wired up. `e2e/fixtures/microsite-rig.ts`'s ASK_PAGE is even a
// ready-made working example. In other words: this knowledge exists in the repo, it's just
// **not on the owner's screen**. And `builder/template/src/main.tsx` doesn't wrap a
// provider -- the owner has to write `<StandMeetProvider>` themselves -- something that
// isn't mentioned at all either.
//
// Criterion: publish the template **exactly as the panel gives it**, and that page must
// actually be able to answer questions.
//   - Don't diff against ASK_PAGE: that would be a second copy of the same fact, which drifts.
//   - Don't just check "build succeeded": `<h1>Hello</h1>` also builds successfully. A
//     successful build is not "the owner got taught".
//   - Get the template through the UI, not by importing from app source: what the owner
//     reads is what's on the screen, so the test should only read that copy too.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'starter@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'starter',
  fullName: 'Stella Starter',
};
const SLUG = 'starter-page';
const ANSWER = 'The starter template answered from the corpus.';

const sm = (page: Page, name: string) => page.locator(`[data-sm="${name}"]`);

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// The sandbox builds only one at a time, and a real build takes tens of seconds to a few
// minutes -- the test-level timeout has to be raised to match, since a timeout on a single
// assertion can't cover the whole test (the default 30s would trip first).
test.describe.configure({ timeout: 300_000 });
test.describe('custom pages · the starter the panel hands you is a working chat page', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('publishing the untouched starter produces a page a reader can ask on',
    async ({ adminPage: page, playwright }) => {
      // The editor starts a fresh page pre-filled with the starter template; publishing it
      // untouched is the whole test.
      await goto(page, '/admin/edit/new');

      // The editor must **first** tell the owner what can be imported. Today it says nothing.
      const help = page.getByTestId('microsite-imports');
      await expect(help).toContainText('@standmeet/sdk');
      await expect(help).toContainText('useChatSession');

      // Publish the editor's own template, unchanged.
      await page.getByTestId('microsite-slug').fill(SLUG);
      await page.getByTestId('microsite-publish').click();
      await expect(page.getByTestId('microsite-build-status'))
        .toHaveText(/built/i, { timeout: 180_000 });

      // Reader's side: this page must actually be able to answer questions.
      const request = await playwright.request.newContext();
      await loginAPI(request, OWNER.email, OWNER.password);
      // The returned tag is this registration's key -- the question must carry it, otherwise
      // the mock doesn't recognize this turn and echoes back the system prompt it received
      // ([[mock-llm-pure-registration-kv]]).
      const tag = await scriptMockReplyText(request, ANSWER);

      const reader = await (await playwright.chromium.launch()).newPage();
      await goto(reader, `/p/${SLUG}`);

      const box = sm(reader, 'ask');
      await box.waitFor({ state: 'visible', timeout: 20_000 });
      await box.fill(`what do you write about? ${tag}`);
      await box.press('Enter');
      await expect(sm(reader, 'answer')).toContainText(ANSWER, { timeout: 30_000 });

      await reader.close();
      await request.dispose();
    });
});
