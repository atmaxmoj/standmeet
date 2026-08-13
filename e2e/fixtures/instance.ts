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
  // assets 按 holder_id 挂,**没有外键** —— 所以 corpus_notes 的 CASCADE 带不走它,
  // 得自己列一行。(以前这里写的是 media_assets:一张从来没有写入方的表,删了。)
  'corpus_notes', 'assets', 'page_content',
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
  // No LLM-gateway reset: the mock is keyword KV — each test embeds a unique
  // keyword (mock-llm-script.ts) in its message, so an unconsumed script sits
  // under a keyword no other test's request contains and can't leak across specs.
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

// ensureStackUp —— 栈已经整齐就别再拉一遍。
//
// 这里原来无条件跑 `docker compose up -d --wait`。全量跑的时候栈**早就起好了**(`make test`
// 的 dev-up 已经 --wait 过),这一趟纯属白付 —— 实测 4~11 秒,而 Playwright 把 hook 的时间
// **算进用例那 30 秒**。于是重活的用例在机器忙的时候被自己的 fixture 挤爆:
// sync-duplicate-title-collapse 就是这么倒的(reset 花了 14.9 秒,同步走到一半被 30 秒截断,
// 后端日志留下的是 "meili wait task 632: context canceled" —— 不是产品挂住)。
// 420 个 spec 文件各付一遍,全量时长里很大一块。
//
// 所以先问再动:一趟 `ps`(约 0.6 秒)看每个 service 在不在、健不健康,整齐就直接走。有任何一个
// 不对 → 照旧 `up -d --wait` 拉起来 —— 安全性质一点没变,只是不再为"本来就好着"付钱。
function ensureStackUp(): void {
  if (stackAlreadyUp()) return;
  execSync(`docker compose ${COMPOSE} up -d --wait`, { stdio: 'inherit' });
}

// stackAlreadyUp —— compose 定义的每个 service 都有一个 running 的容器,且带健康检查的都 healthy。
// 判据取自 compose 自己的 service 清单(不是写死一串名字):加一个 service 而忘了改这里,
// 结果是**退回慢路径**,不是漏检。
function stackAlreadyUp(): boolean {
  try {
    const running = new Map<string, PSRow>();
    psRows().forEach((r) => { r.State === 'running' && running.set(r.Service, r); });
    return definedServices().every((s) => {
      const row = running.get(s);
      // Health 空 = 这个 service 没配健康检查,running 就是它能给的全部信号。
      return row !== undefined && (row.Health === '' || row.Health === 'healthy');
    });
  } catch {
    return false; // compose 问不出话 → 走慢路径,让它自己报错
  }
}

interface PSRow { Service: string; State: string; Health: string }

// psRows —— `ps --format json` 每行一个对象(新版 compose);老版给一个数组,两种都收。
function psRows(): PSRow[] {
  const out = execSync(`docker compose ${COMPOSE} ps --format json`, { encoding: 'utf-8' }).trim();
  if (out === '') return [];
  if (out.startsWith('[')) return JSON.parse(out) as PSRow[];
  return out.split('\n').map((line) => JSON.parse(line) as PSRow);
}

// definedServices —— compose 文件里声明的 service 名。一个 worker 进程里只问一次:
// 文件在一次跑里不会变,而这一趟 exec 也要几百毫秒。
let definedCache: string[] = [];
function definedServices(): string[] {
  if (definedCache.length === 0) {
    definedCache = execSync(`docker compose ${COMPOSE} config --services`, { encoding: 'utf-8' })
      .split('\n').map((s) => s.trim()).filter((s) => s !== '');
  }
  return definedCache;
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

// execSQL —— 跑一条不看结果的语句。用于**制造前置状态**(比如一行 8 天前的用量),
// 那种状态没有任何 API 造得出来:没有"把时间往前拨"的接口,也不该有。
export function execSQL(sql: string): void {
  runPsql(sql.replaceAll('"', '\\"'));
}

// querySQL —— 跑一条查询,返回裸值(单行单列,-tA)。断言"这一行还在不在"用它。
export function querySQL(sql: string): string {
  return execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -tA -c ` +
    `"${sql.replaceAll('"', '\\"')}"`,
    { encoding: 'utf-8' },
  ).trim();
}

// backendLogTail —— 取 backend 最近 n 行日志。
//
// 有些不变量**只在日志里成立或不成立** —— 例如「一轮里派了几次工具调用,就该有几条能各自归因的
// 结果」(F-S-1)。那种东西 UI 上看不见、API 上也读不到,断言的对象本来就是这份日志。
// 用它的用例要自己在注释里说清:为什么这条断言不能走产品的面。
export function backendLogTail(lines = 400): string {
  return execSync(`docker compose ${COMPOSE} logs --tail ${lines} backend`, {
    encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024,
  });
}

// restartBackend —— 让 backend 进程重来一次。周期任务的第一跑就在 boot,所以"起来时
// 清一次老行"这件事,只有重启才观察得到。走 Makefile(所有 docker 操作的唯一入口)。
export function restartBackend(): void {
  execSync('make -C .. dev-restart-svc SVC=backend', { stdio: 'inherit' });
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
