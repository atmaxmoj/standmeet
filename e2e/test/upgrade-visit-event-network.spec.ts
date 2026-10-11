// upgrade-visit-event-network.spec.ts —— old volume + new code: the deploy brings visit_event's
// network / asn / as_org (`2026-10-11-visit-event-network.sql`).
//
// "Done": the columns arrive; every recorded visit is kept and reads no network (it was recorded
// before there was one); a visit after the upgrade records its network.
//
// Method (as upgrade-job-seen): visits recorded on the new code, the columns dropped and the
// migration forgotten (the last release, v0.1.152, has neither), then exactly one action: restart
// the backend (= deploy).

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { openVisitorBrowser } from '@/fixtures/visitor-browser';

const MIGRATION = '2026-10-11-visit-event-network.sql';
const OWNER = {
  email: 'upgrade-network@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgradenetwork', fullName: 'Upgrade Network Owner',
};
const PATH = 'upgrade-network-note';

const count = (sql: string): number => Number(querySQL(sql));
const columns = (): number => count(`SELECT count(*) FROM information_schema.columns
  WHERE table_name='visit_event' AND column_name IN ('network','asn','as_org')`);

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  await initOwnerWithEntry(playwright);
  await readAs(playwright, '8.8.4.4');
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
});

async function readAs(playwright: Playwright, ip: string): Promise<void> {
  const ctx = await openVisitorBrowser(playwright, { 'X-Forwarded-For': ip });
  await ctx.read(`/wiki/${PATH}`);
  await ctx.dispose();
}

test('an old volume + a deploy → the network columns arrive; recorded visits are kept', async ({ playwright, request }) => {
  const visits = count('SELECT count(*) FROM visit_event');
  expect(visits, 'presence: visits were recorded').toBeGreaterThan(0);
  execSQL('ALTER TABLE visit_event DROP COLUMN IF EXISTS network, DROP COLUMN IF EXISTS asn, DROP COLUMN IF EXISTS as_org');
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(columns(), 'pre-state built').toBe(0);

  restartBackend();

  expect(columns(), 'the columns arrived').toBe(3);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM visit_event'), 'visits kept').toBe(visits);
  expect(count(`SELECT count(*) FROM visit_event WHERE network = '' AND asn = 0`),
    'recorded before the upgrade: no network').toBe(visits);

  await readAs(playwright, '1.1.1.1');
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'upgrade-network-read');
  const sid = await initMCP(request, token);
  const page = await callTool<{ items: { network: string }[] }>(request, token, sid, 'monitor.sessions', { window: '7d' });
  expect(page.items.map((s) => s.network), 'a visit after the upgrade records its network').toContain('1.1.1.0/24');
});

async function initOwnerWithEntry(playwright: Playwright): Promise<void> {
  resetInstance();
  const ctx = await playwright.request.newContext();
  await claim(ctx, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(ctx, OWNER.email, OWNER.password);
  const token = await createAPIToken(ctx, csrf, 'upgrade-network-seed');
  const sid = await initMCP(ctx, token);
  const { wikiID: id } = await seedWiki(ctx, token, sid, { title: 'Upgrade Network', body: 'A note.', path: PATH });
  await publishEntry(ctx, token, sid, { genre: 'wiki', id });
  await ctx.dispose();
}
