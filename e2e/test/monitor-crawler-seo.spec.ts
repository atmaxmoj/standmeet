// monitor-crawler-seo.spec.ts —— an AI crawler reading robots.txt and sitemap.xml is recorded,
// and named.
//
// This exists because those two rules shipped dead. They were in monitor's table, correct in
// every field, and could never fire: the recorder was mounted on `/api/v1`, and robots.txt and
// sitemap.xml live at the root by SEO convention. A crawler fetched robots.txt, got 200, and
// nothing was written — no error, no log, nothing to notice.
//
// For a product whose thesis is that an AI answers in the owner's voice, "ClaudeBot read your
// corpus" is the single most on-thesis event this domain can record. It was the one it could
// not record.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { readEvents, visitAsStranger } from '@/fixtures/monitor';

const OWNER = {
  email: 'monitor-crawler@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorcrawler',
  fullName: 'Monitor Crawler',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · crawlers on the root SEO paths', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('robots.txt names the AI crawler that fetched it', async ({ request, playwright }) => {
    await visitAsStranger(playwright, '/robots.txt', 'Mozilla/5.0 (compatible; ClaudeBot/1.0)');

    const rows = await readEvents(request, OWNER, { include_bots: true, surface: 'seo' });
    const row = rows.find((r) => r.event_name === 'robots_fetch');
    expect(row, 'the crawler fetch must be recorded — this route is outside /api/v1').toBeTruthy();
    expect(row?.is_bot).toBe(true);
    // Named, not just counted. "a bot came" is not actionable; "ClaudeBot came" is.
    expect(row?.bot_name).toBe('ClaudeBot');
  });

  test('sitemap.xml is recorded too, with its own event', async ({ request, playwright }) => {
    await visitAsStranger(playwright, '/sitemap.xml', 'Mozilla/5.0 (compatible; Googlebot/2.1)');

    const rows = await readEvents(request, OWNER, { include_bots: true, surface: 'seo' });
    const row = rows.find((r) => r.event_name === 'sitemap_fetch');
    expect(row, 'the sitemap fetch must be recorded').toBeTruthy();
    expect(row?.bot_name).toBe('Googlebot');
  });

  test('crawler traffic stays out of the human numbers', async ({ request, playwright }) => {
    await visitAsStranger(playwright, '/robots.txt', 'Mozilla/5.0 (compatible; GPTBot/1.1)');

    // The default read excludes bots — and these are the routes most likely to be all bot, so a
    // leak here would make the seo surface look like an audience.
    const humans = await readEvents(request, OWNER, { surface: 'seo' });
    expect(humans.length, 'no crawler may appear in the default, bot-free read').toBe(0);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
