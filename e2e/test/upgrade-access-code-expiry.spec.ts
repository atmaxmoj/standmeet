// upgrade-access-code-expiry.spec.ts —— old volume + new code: the deploy brings the expiry rule
// (`2026-10-15-access-code-expiry.sql`: access_code_follows_page, access_code_expired).
//
// "Done": the two functions arrive, no code row changes, and from then on a code past its expiry
// is refused at the door (before the upgrade such a code still opened sessions).
//
// Method (as upgrade-retention-bundles): codes created on the new code, the functions dropped and
// the migration forgotten (v0.1.157 has neither), then exactly one action: restart the backend.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { execSQL, findSetupToken, querySQL, resetInstance, restartBackend } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-10-15-access-code-expiry.sql';
const OWNER = {
  email: 'upgrade-code-expiry@example.com', password: 'correct-horse-battery-staple',
  handle: 'upgradecodeexpiry', fullName: 'Upgrade Code Expiry Owner',
};
const count = (sql: string): number => Number(querySQL(sql));
const functions = (): number => count(`SELECT count(*) FROM pg_proc
  WHERE proname IN ('access_code_expired', 'access_code_follows_page')`);

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  await initOwner(playwright);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  restartBackend();
});

test('an old volume + a deploy → the expiry rule arrives; codes are kept; an expired one is refused', async ({ request }) => {
  const rows = querySQL(`SELECT string_agg(code || ':' || coalesce(expires_at::text, '-'), ',' ORDER BY code) FROM access_codes`);
  execSQL(`DROP FUNCTION IF EXISTS access_code_expired(timestamptz, uuid);
    DROP FUNCTION IF EXISTS access_code_follows_page(uuid);`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
  expect(functions(), 'pre-state built').toBe(0);

  restartBackend();

  expect(functions(), 'the rule arrived').toBe(2);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(querySQL(`SELECT string_agg(code || ':' || coalesce(expires_at::text, '-'), ',' ORDER BY code) FROM access_codes`),
    'no code row changed').toBe(rows);

  const res = await request.post(`${BACKEND}/api/v1/sessions`,
    { data: { handle: OWNER.handle, mode: 'code', code: 'UPG-OLD', visitor_name: 'R' } });
  expect(res.status(), 'the expired code is refused now').toBe(401);
  expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('code_expired');
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const ctx = await playwright.request.newContext();
  await claim(ctx, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(ctx, OWNER.email, OWNER.password);
  await createCode(ctx, csrf, { code: 'UPG-OLD', label: 'old', expires_at: new Date(Date.now() - 60_000).toISOString() });
  await createCode(ctx, csrf, { code: 'UPG-NEVER', label: 'never' });
  await ctx.dispose();
}
