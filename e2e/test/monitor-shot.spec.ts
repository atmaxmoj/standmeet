// monitor-shot.spec.ts —— drives the panel with realistic traffic and saves a screenshot, so
// the finished screen is looked at rather than assumed from green assertions.
//
// Not a guard: it asserts nothing beyond the page rendering. It lives under manual/ because its
// output is an image for a person to read.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { visitAsStranger } from '@/fixtures/monitor';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'monitor-shot@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitorshot',
  fullName: 'Monitor Shot',
};

const ENTRIES = [
  'Attention Is All You Need',
  'Sleep And Memory Consolidation',
  'Why Self Hosting Wins',
];

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';

let slugs: string[] = [];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor panel · screenshot', () => {
  // The reset must happen BEFORE the adminPage fixture signs in. Doing it inside the test body
  // unclaims the instance under an already-established session, and the shell never renders.
  test.beforeAll(async ({ playwright }) => {
    slugs = await initOwner(playwright);
    // A handful of readers, a phone, a crawler, and a link-preview fetch — the shapes an owner
    // actually sees in the first week.
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[0]}`, CHROME_MAC);
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[1]}`, CHROME_MAC);
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[1]}`, SAFARI_IPHONE);
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[2]}`, FIREFOX_LINUX);
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[0]}`,
      'Mozilla/5.0 (compatible; ClaudeBot/1.0)');
    await visitAsStranger(playwright, `/api/v1/wiki/${slugs[2]}`, 'Slackbot-LinkExpanding 1.0');
    await visitAsStranger(playwright, '/api/v1/writings', FIREFOX_LINUX);
    // The root SEO paths — the ones that were silent. An AI crawler reading the corpus is the
    // most on-thesis event this domain records, so it belongs in the picture.
    await visitAsStranger(playwright, '/robots.txt', 'Mozilla/5.0 (compatible; ClaudeBot/1.0)');
    await visitAsStranger(playwright, '/sitemap.xml', 'Mozilla/5.0 (compatible; GPTBot/1.1)');
  });

  test('with realistic traffic', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'monitor');
    // Wait for CONTENT, not for the container. Waiting on `monitor-feed` alone photographed the
    // loading state: the shell was present, every number was 0, and the run went green over a
    // picture of an empty panel. A screenshot is only worth taking once there is something in
    // it, and the wait has to say so.
    await expect(adminPage.getByTestId('monitor-row').first()).toBeVisible();
    await expect(adminPage.getByTestId('stat-views-value')).not.toHaveText('0');
    await adminPage.screenshot({ path: 'manual-runs/monitor-panel.png', fullPage: true });
  });
});

async function initOwner(playwright: Playwright): Promise<string[]> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-shot-seed');
  const sid = await initMCP(request, token);
  const slugs: string[] = [];
  for (const title of ENTRIES) {
    const slug = title.toLowerCase().replaceAll(' ', '-');
    const { wikiID } = await seedWiki(request, token, sid, {
      title, body: `Notes on ${title}.`, path: slug,
    });
    await publishEntry(request, token, sid, { genre: 'wiki', id: wikiID });
    slugs.push(slug);
  }
  await request.dispose();
  return slugs;
}
