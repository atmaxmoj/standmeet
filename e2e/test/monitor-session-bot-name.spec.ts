// monitor-session-bot-name.spec.ts —— a crawler's session names WHICH crawler. "1 bot" is nothing an
// owner can act on; "ClaudeBot read your corpus" is. The session row must show the bot's name, not a
// generic "bot" (the name is stored in props; the sessions aggregate must surface it).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { visitAsStranger } from '@/fixtures/monitor';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'monitor-botname@example.com', password: 'correct-horse-battery-staple',
  handle: 'monitorbotname', fullName: 'Monitor Bot Name Owner',
};
const ENTRY = { title: 'Selling Books', path: 'selling-books' };
const CLAUDEBOT = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · a crawler session names the crawler', () => {
  test.beforeAll(async ({ playwright }) => { await initOwnerWithEntry(playwright); });

  test('a ClaudeBot read shows as a session labelled ClaudeBot, not a generic "bot"',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(90_000);
      // A crawler reads the public entry (a bot beacon is not a thing; crawlers hit the API route).
      await visitAsStranger(playwright, `/api/v1/wiki/${ENTRY.path}`, CLAUDEBOT);

      await goto(page, '/admin/monitor');
      const sessions = page.getByTestId('monitor-sessions');
      await expect(sessions, 'the sessions panel renders').toBeVisible({ timeout: 20_000 });
      // Some session row identifies the crawler by name.
      await expect(
        sessions.getByTestId('monitor-session-id').filter({ hasText: 'ClaudeBot' }),
        'a session row names the crawler (ClaudeBot), not a generic "bot"',
      ).toHaveCount(1);
    });
});

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-botname-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note on selling books.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
}
