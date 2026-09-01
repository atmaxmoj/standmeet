// upgrade-embed-schema.spec.ts —— 旧卷 + 新代码：部署本身把 embeds 表 + limit_per_period 列升上来。
//
// v0.1.x 已发布，所以每一次 schema 改动都有两种上线场景：全新卷（schema.sql 跑一遍）和
// **已经在跑的实例**（走 backend/db/migrations/，后端启动时 pgstore.Migrate 打上）。
// 这条测 ②：一个有数据的库，退回"升级前"的形状，然后**只做一件事：重启后端**（= 部署）。
//
// ⚠️ 不能自己去打那条 SQL —— 那会跑在 prod 不存在的路上。升级只有一条路：restartBackend。
// 顺序敏感：这条 spec 跑的时候库是短暂坏的，e2e 是 workers:1 串行，别改成并行。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// 这个功能分三个 migration：基座（embeds 表 + limit 列）+ 唯一约束（一张码一个 embed）+
// 每-embed 签名密钥（key_id/public_key，widget 防盗）。升级测试要覆盖**三个**都随部署上来 ——
// 少测一个，那个就是「记了账却没真的建」的静默缺口。
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

// embedLedgerRows —— 账本里这三个 migration 记了几条（升级后应是 3）。
function embedLedgerRows(): number {
  return Number(querySQL(
    `SELECT count(*) FROM schema_migrations WHERE name IN (${ledgerList})`,
  ));
}
function embedsTableExists(): boolean {
  return querySQL(`SELECT to_regclass('public.embeds') IS NOT NULL`) === 't';
}
// uniqueIndexExists —— 第二个 migration 的产物：code_id 唯一索引。
function uniqueIndexExists(): boolean {
  return querySQL(`SELECT to_regclass('public.embeds_code_uniq') IS NOT NULL`) === 't';
}
// keyColsExist —— 第三个 migration 的产物：每-embed 签名密钥列。它在，才证明防盗那条也随部署上来。
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

// downgrade —— 退回"这台实例还没升到这一版"的真实形状：embeds 表没有、limit_per_period 列没有、
// 账本里也没有这一条（一台还没升级的实例正是这样：账本在，但没有这一行）。
function downgrade(): void {
  // DROP TABLE embeds CASCADE 连 embeds_code_uniq + key_id/public_key 一起带走。三条账本行都删 ——
  // 一台还没升到这一版的实例，三个 migration 都还没记账。
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
      // 这是新的 request 上下文（beforeAll 那个已 dispose）—— 在它上面登一次，
      // 拿到 owner 的 session cookie + csrf，后面建 embed 的 admin POST 才不是 401。
      const auth = await loginAPI(request, OWNER.email, OWNER.password);

      // 升级前：这个实例上有真实数据（一张码）。
      expect(querySQL(`SELECT code FROM access_codes WHERE code = '${CODE}'`)).toBe(CODE);

      // 退回旧形状。必须真的生效（[[assertion-that-cannot-fail]]）。
      downgrade();
      expect(embedsTableExists(), '前置没造出来：embeds 表还在').toBe(false);
      expect(limitColExists(), '前置没造出来：limit 列还在').toBe(false);
      expect(uniqueIndexExists(), '前置没造出来：唯一索引还在').toBe(false);
      expect(keyColsExist(), '前置没造出来：签名密钥列还在').toBe(false);
      expect(embedLedgerRows(), '账本还留着这三条，启动会跳过 → 没在测升级').toBe(0);

      // 升级 = 部署。没有别的动作。
      restartBackend();

      // 部署把三个 migration 都带上来了 + 各记一次账。
      expect(embedsTableExists()).toBe(true);
      expect(limitColExists()).toBe(true);
      expect(uniqueIndexExists(), '第二个 migration（唯一约束）也随部署上来了').toBe(true);
      expect(keyColsExist(), '第三个 migration（签名密钥列）也随部署上来了').toBe(true);
      expect(embedLedgerRows()).toBe(3);

      // 老数据没坏：升级前的码还在、还能兑换。
      expect(querySQL(`SELECT code FROM access_codes WHERE code = '${CODE}'`)).toBe(CODE);
      expect(await sessionFromOrigin(request, CODE, 'https://anywhere.example'),
        '没被 embed 暴露的旧码升级后仍不受来源限制').toBe(200);

      // 新功能可用：给这张码建个钉了来源的 embed，别的来源被拒。
      const mk = await request.post(`${BACKEND}/api/admin/embeds`, {
        headers: { 'X-Csrftoken': auth.csrf },
        data: { code_id: codeID, label: 'e', allowed_origins: [ALLOWED] },
      });
      expect(mk.status(), '升级后能建 embed').toBe(201);
      expect(await sessionFromOrigin(request, CODE, 'https://evil.example'),
        '升级后 embed 的来源白名单真的生效').toBe(403);

      await request.dispose();
    });
});
