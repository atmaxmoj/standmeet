// instance.ts —— compose 管理：起 stack、清数据，不重启 backend。
//
// 关键设计：
//   1. truncate 业务表 + UPDATE instance_settings.is_claimed=false（保留单行）
//   2. flush redis
//   3. **不再** 在 e2e 侧轮换 setup_token —— backend 的 /api/v1/instance
//      handler 在 unclaimed 期会 self-heal：DB hash 缺失（claim 后清掉）就重新
//      issue 一次，holder + DB 同步更新到新 plaintext。findSetupToken() HTTP
//      GET /api/v1/instance 拿当前可用 plaintext。
//
// backend 完全不重启，sub-second 完成 reset。

import { execSync } from 'node:child_process';

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const DB_CONTAINER = 'standmeet-dev-db-1';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// instance_settings 是 singleton（CHECK id=1），不能 TRUNCATE 否则 backend
// 之后某些 query 会失败——单独 UPDATE 回未 claim 态即可。
const TABLES = [
  'messages', 'conversations', 'code_members',
  'applications', 'access_codes',
  'corpus_notes', 'media_assets', 'page_content',
  'resume_drafts', 'job_fingerprints', 'job_sources',
  'owner_keypairs', 'owners',
];

// resetInstance —— spec beforeAll 调；把 instance 拉回干净状态。秒内完成。
export function resetInstance(): void {
  const t = (label: string) =>
    process.stderr.write(`[reset ${new Date().toISOString()}] ${label}\n`);
  t('ensureStackUp start');
  ensureStackUp();
  t('truncate start');
  truncateTables();
  t('unclaim start');
  unclaim();
  t('flushRedis start');
  flushRedis();
  t('resetJobBoardMock start');
  resetJobBoardMock();
  t('done');
}

// resetJobBoardMock —— ping the external-mock /__mock/reset endpoint so
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

// unclaim —— UPDATE singleton 单行回 is_claimed=false。不动 setup_token_hash
// (claim 流程已经把它清成 NULL；backend 下次 /api/v1/instance 会 self-heal
// 重新 issue token，让 holder + DB hash 同步到新 plaintext)。
function unclaim(): void {
  runPsql(`UPDATE instance_settings SET is_claimed = false WHERE id = 1`);
}

function flushRedis(): void {
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli FLUSHALL`, { stdio: 'inherit' });
}

function runPsql(sql: string): void {
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${sql}"`,
    { stdio: 'inherit' },
  );
}

// findSetupToken —— 拿当前 backend 持有的 plaintext setup token。
// 通过 /api/v1/instance HTTP fetch；backend 在 unclaimed 期 self-heal，
// 总能返一个跟 DB hash 对得上的 plaintext。
//
// Sync wrapper around an HTTP fetch via curl —— spec helpers 大多是 sync
// (resetInstance + findSetupToken 都在 beforeAll 里非 async 调用)，所以
// 用 execSync(curl) 拿 JSON 然后 parse。
export function findSetupToken(): string {
  const body = execSync(
    `curl -sS -m 5 ${BACKEND_URL}/api/v1/instance`,
    { encoding: 'utf-8' },
  );
  const parsed = JSON.parse(body) as { setup_token?: string };
  const token = parsed.setup_token ?? '';
  if (token === '') {
    throw new Error('findSetupToken: backend returned no setup_token (already claimed?)');
  }
  return token;
}
