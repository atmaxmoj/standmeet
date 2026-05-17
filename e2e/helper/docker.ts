// docker.ts —— compose 管理：起 stack、清数据（不 down/up，避免 daemon race）。
//
// 1. ensureStack —— playwright globalSetup 调一次；如果 stack 没起就 up -d --wait。
// 2. resetDB —— spec beforeAll 调；truncate 关键表 + flush redis + restart
//    backend（让 first-run setup token 重新颁发）。比 down -v + up 快 10x，
//    且不会触发 docker daemon "container in use" race。
// 3. findSetupToken —— 从 backend 日志里拿 setup URL token。

import { execSync } from 'node:child_process';

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const DB_CONTAINER = 'standmeet-dev-db-1';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';

// instance_settings 是 singleton（CHECK id=1），不能 TRUNCATE 否则 backend
// 启动报"no rows"——单独 UPDATE 回未 claim 态即可。
const TABLES = [
  'messages', 'conversations', 'code_members', 'access_codes',
  'wiki_entries', 'raw_entries', 'media_assets', 'page_content',
  'api_tokens', 'owners',
];

const RESET_INSTANCE_SQL =
  "INSERT INTO instance_settings (id) VALUES (1) " +
  "ON CONFLICT (id) DO UPDATE SET is_claimed = false, setup_token_hash = NULL";

// resetInstance —— spec beforeAll 调，把数据库 / Redis 清回干净状态、
// 再 restart backend 让 first-run setup token 重新打印。比每个 spec 走
// `docker compose down -v` 快 10x，且不会触发 daemon "container in use" race。
export function resetInstance(): void {
  ensureStackUp();
  truncateTables();
  flushRedis();
  restartBackend();
}

function ensureStackUp(): void {
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

function truncateTables(): void {
  const tableList = TABLES.join(', ');
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "TRUNCATE ${tableList} RESTART IDENTITY CASCADE"`,
    { stdio: 'inherit' },
  );
  execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -c "${RESET_INSTANCE_SQL}"`,
    { stdio: 'inherit' },
  );
}

function flushRedis(): void {
  execSync(`docker exec ${REDIS_CONTAINER} redis-cli FLUSHALL`, { stdio: 'inherit' });
}

function restartBackend(): void {
  execSync(`docker compose ${COMPOSE} restart backend`, { stdio: 'inherit' });
  execSync(`docker compose ${COMPOSE} up -d --wait backend`, { stdio: 'inherit' });
}

export function findSetupToken(): string {
  const logs = execSync(
    `docker compose ${COMPOSE} logs backend --no-color --since 30s`,
  ).toString();
  const matches = Array.from(logs.matchAll(/setup\?t=([\w-]+)/g));
  if (matches.length === 0) throw new Error('setup token not found in recent backend logs');
  // 取最后一个；restart backend 之后会重发一个新的，旧的可能还在日志里
  return matches[matches.length - 1]?.[1] ?? '';
}
