// docker.ts —— compose 管理：起 stack、清数据，不重启 backend。
//
// 关键设计：以前每个 spec 调 `docker compose restart backend` 让后端重新
// 生成 setup token，全套 14 specs 串跑要花 ~3 min 在 docker IO 上，还会
// 偶尔触发 daemon "container in use" race。现在改成：
//   1. truncate 业务表（保留 instance_settings 单行；UPSERT 它）
//   2. flush redis（清 owner session / visitor session）
//   3. 客户端生成一个 setup token + 算 sha256，直接 UPDATE 进 DB
//   4. e2e 拿到这个 plaintext token 去 claim
// backend 完全不重启，sub-second 完成 reset；ensureSetupToken 只在第一次
// 启动跑过一次，之后由 e2e 直接接管 token 颁发。

import { execSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const DB_CONTAINER = 'standmeet-dev-db-1';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';

// instance_settings 是 singleton（CHECK id=1），不能 TRUNCATE 否则 backend
// 之后某些 query 会失败——单独 UPDATE 回未 claim 态 + 写新 hash 即可。
const TABLES = [
  'messages', 'conversations', 'code_members',
  'applications', 'access_codes',
  'wiki_entries', 'raw_entries', 'media_assets', 'page_content',
  'resume_drafts', 'job_fingerprints', 'job_sources',
  'api_tokens', 'owners',
];

// 当前 spec 看到的 setup token plaintext；resetInstance 写、findSetupToken 读。
let currentSetupToken = '';

// resetInstance —— spec beforeAll 调；把 instance 拉回干净状态。秒内完成。
//
// Each phase is logged with a high-res timestamp so backend logs (which use
// nanosecond ISO timestamps too) can be cross-referenced against
// "TRUNCATE happened at T1; backend's FK violation happened at T2" — if
// T1 lands between login (creates session) and tokens (writes api_tokens),
// then resetInstance is racing the previous test's still-in-flight calls.
export function resetInstance(): void {
  const t = (label: string) =>
    process.stderr.write(`[reset ${new Date().toISOString()}] ${label}\n`);
  t('ensureStackUp start');
  ensureStackUp();
  t('truncate start');
  truncateTables();
  t('flushRedis start');
  flushRedis();
  t('resetJobBoardMock start');
  resetJobBoardMock();
  t('rotateSetupToken start');
  rotateSetupToken();
  t('done');
}

// resetJobBoardMock —— ping the job-board-mock /__mock/reset endpoint so
// any previous spec's set_day=2 mutations don't bleed across runs.
// Best-effort: 5s timeout; failure logs to stderr but doesn't abort
// (e.g., when mock is intentionally not running, specs that don't touch
// jobs/* still want a clean instance).
function resetJobBoardMock(): void {
  try {
    execSync(
      `curl -sS -m 5 -X POST http://localhost:9000/__mock/reset`,
      { stdio: 'pipe' },
    );
  } catch {
    // mock unavailable → ignore. spec that does need it will fail loudly
    // when it tries to fetch_new.
  }
}

function ensureStackUp(): void {
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

function truncateTables(): void {
  const tableList = TABLES.join(', ');
  runPsql(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
}

function flushRedis(): void {
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli FLUSHALL`, { stdio: 'inherit' });
}

// rotateSetupToken —— 客户端生成 plaintext + 算 sha256，直接 UPSERT 进
// instance_settings。等价于 backend 启动时 IssueSetupToken 干的事。
function rotateSetupToken(): void {
  const plaintext = makeToken();
  const hash = sha256Hex(plaintext);
  const sql =
    `INSERT INTO instance_settings (id, is_claimed, setup_token_hash) ` +
    `VALUES (1, false, '${hash}') ` +
    `ON CONFLICT (id) DO UPDATE SET is_claimed = false, setup_token_hash = '${hash}'`;
  runPsql(sql);
  currentSetupToken = plaintext;
}

function runPsql(sql: string): void {
  // 单引号 quote shell；SQL 里不含单引号（hash 是 hex + plaintext 是 base64url）
  // 所以不需要进一步 escape。
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'inherit' },
  );
}

function makeToken(): string {
  // backend IssueSetupToken 也用 32 bytes base64url；保持一致。
  return randomBytes(32).toString('base64url');
}

function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

// findSetupToken —— 返回 resetInstance 写下的 plaintext token。
export function findSetupToken(): string {
  if (currentSetupToken === '') {
    throw new Error('findSetupToken called before resetInstance');
  }
  return currentSetupToken;
}
