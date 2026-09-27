// upgrade-embed-sync-mode.spec.ts —— old volume + new code: the deploy brings up embeds.sync_mode,
// and an embed that already had an update hook comes out `copy`, every other embed `live`
// (docs/design/event-bus-outbox-webhooks.md, *Embed sync mode*).
//
// There is exactly one upgrade path: restartBackend (= a deploy). The downgrade puts the database in
// the shape of an instance that has not upgraded yet: no column, no ledger row. Order-sensitive:
// e2e runs workers:1 serial.

import { test, expect } from '@/fixtures/test';
import { login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';
import { createEmbedFor, publicSyncMode, setEmbedHook, type HookedEmbed } from '@/fixtures/webhooks';

const MIGRATION = '2026-09-27-embed-sync-mode.sql';

let O: RetrievalOwner;

async function embedOn(csrf: string, roleID: string, code: string): Promise<HookedEmbed> {
  const { id } = await createCode(O.request, csrf, { code, label: code, assumed_role_id: roleID });
  return createEmbedFor(O, id, code);
}

function columnExists(): boolean {
  return querySQL(`SELECT count(*) FROM information_schema.columns
                   WHERE table_name = 'embeds' AND column_name = 'sync_mode'`) === '1';
}

test.use({ ownerCredentials: { email: 'syncupgrade@example.com', password: 'correct-horse-battery-staple' } });
test.describe('upgrade · deploying brings up embeds.sync_mode from the hooks that exist', () => {
  test.describe.configure({ timeout: 300_000 });
  test.afterAll(async () => { restartBackend(); await O?.request.dispose(); });

  test('an embed with a hook comes out copy, one without comes out live', async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'syncupgrade');
    const { csrf } = await loginAPI(O.request, O.email, O.password);
    const roleID = (await createRole(O.request, csrf, {
      name: 'syncup', description: 'wiki', corpus_uris: ['wiki://**'],
    })).id;
    const hooked = await embedOn(csrf, roleID, 'SYNCUP-HOOKED');
    await setEmbedHook(O, hooked.id, 'sync-upgrade');
    const plain = await embedOn(csrf, roleID, 'SYNCUP-PLAIN');

    // The shape of an instance that has not upgraded. It must really take effect.
    execSQL(`ALTER TABLE embeds DROP COLUMN IF EXISTS sync_mode`);
    execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
    expect(columnExists(), 'precondition: the column is gone').toBe(false);

    restartBackend();

    expect(columnExists()).toBe(true);
    expect(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe('1');
    expect(await publicSyncMode(O.request, hooked.key_id)).toEqual({ status: 200, mode: 'copy' });
    expect(await publicSyncMode(O.request, plain.key_id)).toEqual({ status: 200, mode: 'live' });
  });
});
