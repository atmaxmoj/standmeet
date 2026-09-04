// upgrade-embed-schema.spec.ts —— old volume + new code: the deploy itself brings up the embeds table + limit_per_period column.
//
// v0.1.x has already shipped, so every schema change now has two rollout
// paths: a brand-new volume (schema.sql runs once) and **an already-running
// instance** (goes through backend/db/migrations/, applied by pgstore.Migrate
// on backend boot). This case tests path ②: a database with real data, rolled
// back to the "pre-upgrade" shape, then **exactly one action: restart the
// backend** (= a deploy).
//
// Warning: don't run that SQL by hand — that would exercise a path that
// doesn't exist in prod. There is exactly one upgrade path: restartBackend.
// Order-sensitive: the database is briefly broken while this spec runs; e2e
// runs workers:1 serial, don't change that to parallel.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { signEmbedToken } from '@/fixtures/embed-token';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// This feature splits into three migrations: the base (embeds table + limit
// column) + a unique constraint (one embed per code) + a per-embed signing key
// (key_id/public_key, anti-widget-theft). The upgrade test needs to cover
// **all three** landing via the deploy — skipping one leaves the silent gap of
// "recorded in the ledger but never actually built".
const MIGRATION_BASE = '2026-09-01-code-embed-limits.sql';
const MIGRATION_UNIQUE = '2026-09-01-embed-one-per-code.sql';
const MIGRATION_SIGNING = '2026-09-01-embed-signing-key.sql';
const ALL_MIGRATIONS = [MIGRATION_BASE, MIGRATION_UNIQUE, MIGRATION_SIGNING];

const OWNER = {
  email: 'embedupgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'embedupgrade', fullName: 'Embed Upgrade Owner',
};
const CODE = 'UPGRADE-EMBED';
const ALLOWED = 'https://alice.example';

const ledgerList = ALL_MIGRATIONS.map((m) => `'${m}'`).join(', ');

// embedLedgerRows —— how many of these three migrations are recorded in the ledger (should be 3 after upgrade).
function embedLedgerRows(): number {
  return Number(querySQL(
    `SELECT count(*) FROM schema_migrations WHERE name IN (${ledgerList})`,
  ));
}
function embedsTableExists(): boolean {
  return querySQL(`SELECT to_regclass('public.embeds') IS NOT NULL`) === 't';
}
// uniqueIndexExists —— the artifact of the second migration: the code_id unique index.
function uniqueIndexExists(): boolean {
  return querySQL(`SELECT to_regclass('public.embeds_code_uniq') IS NOT NULL`) === 't';
}
// keyColsExist —— the artifact of the third migration: the per-embed signing key columns. Their presence is what proves the anti-theft measure also landed with the deploy.
function keyColsExist(): boolean {
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='embeds' AND column_name IN ('key_id','public_key')`,
  )) === 2;
}
function limitColExists(): boolean {
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='access_codes' AND column_name='limit_per_period'`,
  )) === 1;
}

// downgrade —— rolls back to the real shape of "this instance hasn't upgraded
// to this version yet": no embeds table, no limit_per_period column, and no
// row in the ledger for it either (exactly what a not-yet-upgraded instance
// looks like: the ledger exists, but this row doesn't).
function downgrade(): void {
  // DROP TABLE embeds CASCADE takes embeds_code_uniq + key_id/public_key down
  // with it. All three ledger rows are deleted too — a not-yet-upgraded
  // instance hasn't recorded any of the three migrations.
  execSQL(`DROP TABLE IF EXISTS embeds CASCADE`);
  execSQL(`ALTER TABLE access_codes DROP COLUMN IF EXISTS limit_per_period`);
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${ledgerList})`);
}

async function sessionFromOrigin(
  request: APIRequestContext, code: string, origin: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { mode: 'code', code, visitor_name: 'V' },
  });
  return res.status();
}

test.describe('upgrade · deploying the new version brings up the embeds table + limit column', () => {
  test.describe.configure({ timeout: 300_000 });
  let csrf = '';
  let codeID = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    const role = await createRole(request, csrf, {
      name: 'up-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    const c = await createCode(request, csrf, { code: CODE, label: 'up', assumed_role_id: role.id });
    codeID = c.id;
    await request.dispose();
  });

  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy → the embeds table and limit column come back, old code still works',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // This is a fresh request context (the beforeAll one has already been
      // disposed) — log in on it once to get the owner's session cookie + csrf,
      // so the admin POST that creates the embed later isn't a 401.
      const auth = await loginAPI(request, OWNER.email, OWNER.password);

      // Before the upgrade: this instance has real data (one code).
      expect(querySQL(`SELECT code FROM access_codes WHERE code = '${CODE}'`)).toBe(CODE);

      // Roll back to the old shape. Must genuinely take effect ([[assertion-that-cannot-fail]]).
      downgrade();
      expect(embedsTableExists(), '前置没造出来：embeds 表还在').toBe(false);
      expect(limitColExists(), '前置没造出来：limit 列还在').toBe(false);
      expect(uniqueIndexExists(), '前置没造出来：唯一索引还在').toBe(false);
      expect(keyColsExist(), '前置没造出来：签名密钥列还在').toBe(false);
      expect(embedLedgerRows(), '账本还留着这三条，启动会跳过 → 没在测升级').toBe(0);

      // Upgrade = deploy. No other action.
      restartBackend();

      // The deploy brought up all three migrations + recorded each in the ledger.
      expect(embedsTableExists()).toBe(true);
      expect(limitColExists()).toBe(true);
      expect(uniqueIndexExists(), '第二个 migration（唯一约束）也随部署上来了').toBe(true);
      expect(keyColsExist(), '第三个 migration（签名密钥列）也随部署上来了').toBe(true);
      expect(embedLedgerRows()).toBe(3);

      // Old data isn't broken: the pre-upgrade code still exists, and still redeems.
      // A DIRECT plaintext code stays open from any origin by design (the origin
      // allowlist gates only the widget/embed_token path — a leaked code is handled
      // by revocation, not origin-pinning). See embed-direct-code-stays-open.spec.ts.
      expect(querySQL(`SELECT code FROM access_codes WHERE code = '${CODE}'`)).toBe(CODE);
      expect(await sessionFromOrigin(request, CODE, 'https://anywhere.example'),
        '没被 embed 暴露的旧码升级后仍不受来源限制').toBe(200);

      // The new feature works end-to-end post-upgrade: create an embed pinned to an
      // origin (the server mints its Ed25519 keypair, proving the signing-key columns
      // came up), then an embed_token signed for an off-allowlist origin is refused (403).
      const mk = await request.post(`${BACKEND}/api/admin/embeds`, {
        headers: { 'X-Csrftoken': auth.csrf },
        data: { code_id: codeID, label: 'e', allowed_origins: [ALLOWED] },
      });
      expect(mk.status(), '升级后能建 embed').toBe(201);
      const embed = await mk.json() as { id: string; key_id: string; private_key: string };
      expect(embed.key_id && embed.private_key, '升级后 embed 带回了签名密钥').toBeTruthy();
      const evilToken = signEmbedToken({
        keyId: embed.key_id, embedId: embed.id,
        origin: 'https://evil.example', privateKeyPem: embed.private_key,
      });
      const evil = await request.post(`${BACKEND}/api/v1/sessions`, {
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        data: { mode: 'code', embed_token: evilToken, visitor_name: 'V' },
      });
      expect(evil.status(), '升级后 embed 的来源白名单真的生效（token 路径）').toBe(403);

      await request.dispose();
    });
});
