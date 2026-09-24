// upgrade-public-conversation-policy.spec.ts — an old volume + new code: the deploy carries the
// public-conversation-policy migration (`2026-09-24-public-conversation-policy.sql`, one new table).
//
// The full suite only exercises a fresh volume (schema.sql), which proves nothing about an upgrade.
// Method (mirrors upgrade-monitoring-enabled-column): on a DB that already has an owner AND old
// public conversations, roll back to the real pre-upgrade shape — drop the table AND delete this
// migration's ledger row — then do exactly one thing: restart the backend (= deploy). The
// migration must arrive through the real mechanism, never applied by the test.
//
// What an upgrade must not do: prune. The periodic prune runs once at boot; an instance that never
// set a policy must read as "save, no prune", so the owner's old public conversations survive.
//
// Serial (workers:1): the DB is briefly in a broken state mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const MIGRATION = '2026-09-24-public-conversation-policy.sql';
const TABLE = 'public_conversation_policy';

const OWNER = {
  email: 'policy-upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'policyupgrader',
  fullName: 'Polly Upgrader',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

function tableCount(): number {
  return Number(querySQL(`SELECT count(*) FROM information_schema.tables WHERE table_name='${TABLE}'`));
}

function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}

function oldPublicConvs(): number {
  return Number(querySQL(`SELECT count(*) FROM conversations WHERE visitor_name = 'pre-upgrade'`));
}

test.describe('upgrade · deploying the new version adds the public-conversation policy to a live instance', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  // Safety net: if a test dies mid-run the DB is left in the old shape; one more restart fixes it.
  test.afterAll(() => { restartBackend(); });

  test('an old volume with old public conversations + a deploy → schema applied, nothing pruned', () => {
    const ownerID = querySQL(`SELECT id FROM owners WHERE handle = '${OWNER.handle}'`);
    execSQL(
      `INSERT INTO conversations (owner_id, mode, visitor_name, started_at, last_at)
       VALUES ('${ownerID}', 'public', 'pre-upgrade', now() - interval '400 days', now() - interval '400 days')`,
    );

    // Roll back to the pre-upgrade shape — it must actually take effect, or this is a fake,
    // permanently-green upgrade test.
    execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(tableCount(), 'pre-state not built: the table is still there').toBe(0);
    expect(ledgerRows(), 'the ledger still has the row; startup would skip it').toBe(0);

    // Upgrade = deploy. No other action. (The prune job runs once at this boot.)
    restartBackend();

    expect(tableCount()).toBe(1);
    expect(ledgerRows()).toBe(1);
    expect(oldPublicConvs(), 'an upgrade never prunes the owner\'s old public conversations').toBe(1);
  });

  test('…and after the deploy the owner sees the default policy (saved, no cleanup) and can set it',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'conversations');
      await expect(page.getByTestId('conv-policy-save-toggle')).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('conv-prune-cron')).toHaveValue('');

      // The new table is writable on the upgraded instance.
      await page.getByTestId('conv-prune-cron').fill('@weekly');
      await page.getByTestId('conv-prune-save').click();
      await expect(page.getByTestId('conv-prune-status')).toContainText('@weekly', { timeout: 10_000 });
      expect(Number(querySQL(`SELECT count(*) FROM ${TABLE} WHERE prune_cron = '@weekly'`))).toBe(1);
    });
});
