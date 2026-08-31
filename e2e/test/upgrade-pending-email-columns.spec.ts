// upgrade-pending-email-columns.spec.ts —— 旧卷 + 新代码，**升级由部署本身完成**。
//
// v0.0.1 已经发布出去了，所以每一次 schema 改动都有两种上线场景：
//   ① 全新的 pg 卷 —— `schema.sql` 跑一遍，什么都对
//   ② **已经在跑的实例** —— 卷里已经有 owner、码、语料，然后新版本上来
//
// 整套 e2e 一直只测 ①（[[schema-lives-in-the-volume-not-the-image]]：空卷上绿证明不了升级）。
//
// ⚠️ 这条 spec 的第一版**自己去打那条 SQL**（`applyMigration(MIGRATION)`）。
// 它绿了，而它证明的只是"那个 .sql 文件写得对" —— 因为真实的实例里没有任何人做那一步。
// 「migration 怎么到达一台实例」，也就是真正会坏的那一段，被测试自己代劳了。
// 那个 fixture 已经删掉，所以现在**升级只有一条路**：重启后端，也就是部署。
//
// 手法：在一个有数据的库上退回"升级前"的真实形状 —— 删掉新列，**并且删掉账本里那一行**
// （一台还没升级的实例正是这个样子：账本在，但没有这一条）。然后只做一件事：重启后端。
//
// 顺序敏感：这条 spec 跑的时候库是短暂坏的，e2e 是 workers:1 串行，别改成并行。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import {
  execSQL, findSetupToken, querySQL, resetInstance, restartBackend,
} from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MIGRATION = '2026-08-31-pending-email.sql';
const NEW_COLUMNS = ['pending_email', 'pending_email_token_hash', 'pending_email_expires_at'];

const OWNER = {
  email: 'upgrader@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'upgrader',
  fullName: 'Ursula Upgrader',
};

function columnCount(): number {
  const list = NEW_COLUMNS.map((c) => `'${c}'`).join(',');
  return Number(querySQL(
    `SELECT count(*) FROM information_schema.columns ` +
    `WHERE table_name='owners' AND column_name IN (${list})`,
  ));
}

// ledgerRows —— 账本里这一条 migration 有几行。**恰好一行**是它自己的不变量：
// 零＝没打过，两行＝打了两遍（而八个文件里有一条 UPDATE 是不可重入的）。
function ledgerRows(): number {
  return Number(querySQL(
    `SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`,
  ));
}

// downgrade —— 把库退回"这台实例还没升到这一版"的真实形状。
// 两件事都要做：列没有，**账本里也没有这一条**。只删列的话，账本会说"打过了"，
// 于是启动时跳过 —— 那样测出来的是账本工作正常，不是升级工作正常。
function downgrade(): void {
  execSQL(`ALTER TABLE owners ${NEW_COLUMNS.map((c) => `DROP COLUMN IF EXISTS ${c}`).join(', ')}`);
  execSQL(`DELETE FROM schema_migrations WHERE name = '${MIGRATION}'`);
}

async function loginStatus(
  request: APIRequestContext, email: string, password: string,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  return res.status();
}

// seedInstance —— 一台"已经在跑、上面有东西"的实例。升级测的就是这种实例。
async function seedInstance(request: APIRequestContext): Promise<void> {
  resetInstance();
  await claim(request, findSetupToken(), OWNER);
  // 配 mail connector：**新列只在待确认那条路上才被用到**。没有它，改邮箱走直换、
  // 三个新列一次也不碰 —— 那样"新功能可用"就成了一句没验到东西的话。
  await configureMailConnector(request, OWNER.email, OWNER.password);
  // 种一篇 writing：重跑回填那条用例要断言「owner 选过的颜色没被抹掉」，
  // 而刚重置的实例一篇都没有 —— 那条用例会 skip 掉自己，成为一条不会失败的断言
  // （[[assertion-that-cannot-fail]]）。
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'upgrade-seed');
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'writing_create', {
    slug: 'upgrade-hued', title: 'A writing with a chosen hue', excerpt: 'x',
    body_md: 'the owner picked this colour on purpose', tags: [], publish: true,
  });
  await request.dispose();
}

// expectEmailChangeGoesPending —— 升级之后那三列真的能写能读。
// 断在**列上**，不只是"接口回了 200"：要证明的是新 schema 在用。
async function expectEmailChangeGoesPending(request: APIRequestContext): Promise<void> {
  const moved = 'upgrader+moved@example.com';
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  const res = await request.patch(`${BACKEND}/api/admin/account/email`, {
    headers: { 'X-Csrftoken': csrf },
    data: { current_password: OWNER.password, new_email: moved },
  });
  expect(res.status()).toBe(200);
  expect(querySQL(`SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`))
    .toBe(moved);
  // 身份还没动：确认之前，登录用的仍是老邮箱。
  expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
}

test.describe('upgrade · deploying the new version migrates an instance that already has data', () => {
  // 每条用例里都有**一次真实的部署**（docker compose restart + 等健康），
  // 一次就吃掉默认 30s 的大半。第一版没设这个，于是用例在 PATCH 那一行被时钟砍断 ——
  // 而那个 PATCH 其实 200 成功了（后端日志 829ms）。超时不是"没做"的证据。
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    await seedInstance(await playwright.request.newContext());
  });

  // 兜底：这条用例中途死掉的话，库停在旧形状。再重启一次就会补上 ——
  // 而"重启即修复"本身就是这套机制该有的样子。
  test.afterAll(() => {
    restartBackend();
  });

  // 这一条和下一条是同一次升级的两半：先问"部署带上来了吗"，再问"东西还好吗"。
  // 顺序相关（workers:1 串行）：下一条跑在这一条留下的、已升级的实例上。
  test('an old volume + a deploy of the new version → the deploy applies the schema', () => {
    // 升级前：这个实例上有真实数据。
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(OWNER.email);

    // 退回旧形状。**必须真的生效** —— 否则后面全是在新 schema 上跑，
    // 一条永远绿的假升级测试（[[assertion-that-cannot-fail]]）。
    downgrade();
    expect(columnCount(), '前置状态没造出来：列还在，这条测试证明不了任何事').toBe(0);
    expect(ledgerRows(), '账本里还留着这一条，启动时会跳过 —— 那就没在测升级').toBe(0);

    // 升级 = 部署。没有别的动作。
    // 这一行如果换成"测试自己打 SQL"，这条 spec 就退回它坏掉的第一版。
    restartBackend();

    expect(columnCount()).toBe(NEW_COLUMNS.length);
    expect(ledgerRows()).toBe(1);
  });

  test('…and after that deploy the old data, the old login and the new feature all work',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();

      // 老数据还在，没被 ALTER 改坏。
      expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
        .toBe(OWNER.email);
      // 新列对**已存在的行**要有安全默认 —— 这是加 NOT NULL 列时真正会炸的地方。
      expect(querySQL(
        `SELECT pending_email IS NULL AND pending_email_token_hash = '' ` +
        `FROM owners WHERE handle = '${OWNER.handle}'`,
      )).toBe('t');

      // 老功能没坏：升级前就存在的 owner 还登得上。
      expect(await loginStatus(request, OWNER.email, OWNER.password)).toBe(200);
      // 新功能可用。
      await expectEmailChangeGoesPending(request);

      await request.dispose();
    });

  // 重部署、回滚再上、运维手抖 —— 同一个版本会被部署很多次。
  // 账本的作用就是让第二次什么都不做：八个 migration 里
  // `2026-08-16-cover-hue-never-chosen.sql` 那条 UPDATE **不可重入**，
  // 重跑一次会把 owner 后来手动设过的 cover_hue 再抹掉一遍。
  test('deploying the same version again is a no-op: the ledger keeps it at one', () => {
    const emailBefore = querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`);
    const pendingBefore = querySQL(
      `SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`,
    );

    restartBackend();
    restartBackend();

    expect(columnCount()).toBe(NEW_COLUMNS.length);
    expect(ledgerRows(), '同一条被记了不止一次 —— 说明它被重跑了').toBe(1);
    // 数据没被第二次部署动过。
    expect(querySQL(`SELECT email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(emailBefore);
    expect(querySQL(`SELECT pending_email FROM owners WHERE handle = '${OWNER.handle}'`))
      .toBe(pendingBefore);
  });

  // 一台**从来没见过这套机制**的实例：账本表还不存在，而且缺一条 migration。
  //
  // 这一条是从真实环境里换来的。第一版有个"基线"分支：没有账本就把八条全记成已应用、
  // 一条都不跑，理由是"它们的结果本来就在库里"。dev 上第一次跑就证伪了 —— 那台实例
  // 没账本、而且真的缺一条，于是那一条被永久记成打过了，列还是不存在，什么都没报。
  // 而那正是**每台老实例第一次启动**时走的分支。
  test('an instance with no ledger and a missing migration gets it applied, not assumed', () => {
    downgrade();
    execSQL('DROP TABLE IF EXISTS schema_migrations');
    expect(columnCount()).toBe(0);

    restartBackend();

    expect(columnCount(), '账本不存在时它假设了"已经打过" —— 那条 migration 被跳过了')
      .toBe(NEW_COLUMNS.length);
    expect(ledgerRows()).toBe(1);
  });

  // 重跑八条 migration 不许损坏数据。唯一带数据回填的那条
  // （`2026-08-16-cover-hue-never-chosen.sql`）清的是产品给不出的状态
  // ——封面只存在于 writing，而它的 WHERE 是 `genre <> 'writing'`。
  // 这条断言盯着那句话：哪天有人把回填放宽到 owner 真能设色的 genre，重部署就成了数据损失。
  test('replaying every migration does not touch a hue the owner can actually set', () => {
    execSQL(
      `UPDATE corpus_notes SET cover_hue = 'sage' WHERE genre = 'writing'`,
    );
    const painted = Number(querySQL(
      `SELECT count(*) FROM corpus_notes WHERE genre = 'writing' AND cover_hue = 'sage'`,
    ));
    // 断在**非零**上：beforeAll 种过一篇。零意味着前置状态没造出来，
    // 那后面那句"颜色还在"就永远成立了。
    expect(painted, '前置状态没造出来：没有上过色的 writing，这条断言不会失败').toBeGreaterThan(0);

    execSQL('DROP TABLE IF EXISTS schema_migrations');
    restartBackend();

    expect(Number(querySQL(
      `SELECT count(*) FROM corpus_notes WHERE genre = 'writing' AND cover_hue = 'sage'`,
    )), '重跑把 owner 选过的颜色抹掉了 —— 那条回填的射程被放宽了').toBe(painted);
  });
});
