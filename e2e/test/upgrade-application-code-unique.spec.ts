// upgrade-application-code-unique.spec.ts —— 旧卷 + 新代码：部署把 applications.access_code_id 的
// 唯一约束升上来，已有的 application 数据不动。
//
// 访客侧的简历工具靠 GetApplicationByAccessCode(:one) 按 session 的码反查"这一份" application。
// 隔离建立在"一码一份"这个不变量上，而这个不变量必须由**约束**保证，不能靠"commit 每次恰好发新码"
// 这个约定。于是每次 schema 改动的两条上线路都要成立：全新卷（schema.sql）+ 已在跑的实例
// （backend/db/migrations/，pgstore.Migrate 启动时打上）。这条测 ②：一个有数据的库，退回升级前的
// 形状，然后**只做一件事：重启后端**（= 部署）。
//
// ⚠️ 不能自己去打那条 SQL —— 那会跑在 prod 不存在的路上。升级只有一条路：restartBackend。
// 顺序敏感：这条 spec 跑的时候库是短暂坏的，e2e 是 workers:1 串行，别改成并行。

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';

const MIGRATION = '2026-09-01-application-code-unique.sql';

const OWNER = {
  email: 'appuniqueupgrade@example.com', password: 'correct-horse-battery-staple',
  handle: 'appuniqueupgrade', fullName: 'App Unique Upgrade Owner',
};
const CODE = 'UPGRADE-APP-UNIQ';

// uniqueIndexExists —— the migration's product: the unique index on access_code_id.
function uniqueIndexExists(): boolean {
  return querySQL(`SELECT to_regclass('public.applications_access_code_uniq') IS NOT NULL`) === 't';
}
// uniqueIndexIsUnique —— existence is not enough: a name can lie. Assert it is actually UNIQUE, so a
// second application on one code would be rejected (the invariant isolation rests on).
function uniqueIndexIsUnique(): boolean {
  return querySQL(
    `SELECT indisunique FROM pg_index ` +
    `WHERE indexrelid = 'public.applications_access_code_uniq'::regclass`,
  ) === 't';
}
function ledgerRows(): number {
  return Number(querySQL(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`));
}
function applicationRows(codeID: string): number {
  return Number(querySQL(
    `SELECT count(*) FROM applications WHERE access_code_id = '${codeID}'`,
  ));
}

// downgrade —— 退回"这台实例还没升到这一版"的真实形状：唯一索引换回非唯一索引，账本里删掉这一条
// （一台还没升级的实例正是这样：账本在，但没有这一行）。application 数据一行不动。
function downgrade(): void {
  execSQL(`DROP INDEX IF EXISTS applications_access_code_uniq`);
  execSQL(`CREATE INDEX IF NOT EXISTS applications_access_code_idx ON applications(access_code_id)`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

test.describe('upgrade · deploying brings up the application-code unique constraint', () => {
  test.describe.configure({ timeout: 300_000 });
  let codeID = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'up-role', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    const c = await createCode(request, csrf, { code: CODE, label: 'up', assumed_role_id: role.id });
    codeID = c.id;
    await request.dispose();
  });

  test.afterAll(() => { restartBackend(); });

  test('an old volume + a deploy → the unique index comes back, the application row survives',
    async () => {
      // Real data on this instance: one committed application on the code.
      const ownerID = querySQL(`SELECT owner_id FROM access_codes WHERE code = '${CODE}'`);
      execSQL(
        `INSERT INTO applications (owner_id, access_code_id, job_snapshot, resume_content) ` +
        `VALUES ('${ownerID}', '${codeID}', '{}'::jsonb, '{"summary":"UPGRADE-SURVIVOR"}'::jsonb)`,
      );
      expect(applicationRows(codeID), 'seeded one application').toBe(1);

      // 退回旧形状。必须真的生效（[[assertion-that-cannot-fail]]）。
      downgrade();
      expect(uniqueIndexExists(), '前置没退干净：唯一索引还在').toBe(false);
      expect(ledgerRows(), '账本还留着这条，启动会跳过 → 没在测升级').toBe(0);

      // 升级 = 部署。没有别的动作。
      restartBackend();

      // 部署把 migration 带上来了 + 记一次账。
      expect(uniqueIndexExists(), '唯一索引随部署上来了').toBe(true);
      expect(uniqueIndexIsUnique(), '它是真的 UNIQUE，不只是同名的索引').toBe(true);
      expect(ledgerRows()).toBe(1);

      // 老数据没坏：升级前那份 application 还在。
      expect(applicationRows(codeID), '升级不动已有的 application 数据').toBe(1);
    });
});
