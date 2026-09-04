// instance.ts —— compose management: bring the stack up, clear data, without
// restarting the backend.
//
// Key design:
//   1. truncate the business tables + UPDATE instance_settings.is_claimed=false
//      (keeping the single row)
//   2. flush redis
//   3. **no longer** rotate setup_token on the e2e side —— the backend's
//      /api/v1/instance handler self-heals while unclaimed: if the DB hash is
//      missing (cleared after claim) it re-issues one, updating holder + DB in
//      sync to a new plaintext. findSetupToken() HTTP GET /api/v1/instance gets
//      the currently usable plaintext.
//
// The backend never restarts, so reset completes sub-second.

import { execSync } from 'node:child_process';

const COMPOSE = '-f ../docker-compose.dev.yml -p standmeet-dev';
const DB_CONTAINER = 'standmeet-dev-db-1';
const REDIS_CONTAINER = 'standmeet-dev-redis-1';
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// instance_settings is a singleton (CHECK id=1); it must not be TRUNCATEd or some
// later backend query fails — just UPDATE it back to the unclaimed state.
const TABLES = [
  'messages', 'conversations', 'code_members',
  'applications', 'access_codes',
  // assets hang off holder_id and have **no foreign key** —— so corpus_notes's
  // CASCADE doesn't carry them, and they need their own line here. (This used to
  // read media_assets: a table that never had a writer, since deleted.)
  'corpus_notes', 'assets', 'page_content',
  'resume_drafts', 'job_fingerprints', 'job_sources',
  'owner_keypairs', 'owners',
];

// resetInstance —— called from a spec's beforeAll; pull the instance back to a
// clean state. Completes within a second.
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

// ensureStackUp —— don't bring the stack up again if it's already healthy.
//
// This used to unconditionally run `docker compose up -d --wait`. In a full run
// the stack is **already up** (`make test`'s dev-up already --waited), so this
// pass is pure waste —— measured at 4~11 seconds, and Playwright **counts the hook
// time against the case's 30 seconds**. So a heavy case gets squeezed out by its
// own fixture when the machine is busy: sync-duplicate-title-collapse fell exactly
// this way (reset took 14.9s, the sync was cut off halfway by the 30s limit, and
// the backend log left "meili wait task 632: context canceled" —— not the product
// hanging). Paid once per each of 420 spec files, it's a big chunk of the full run.
//
// So ask before acting: one `ps` pass (~0.6s) checks whether each service is
// present and healthy, and if it's all in order, just proceed. If any one is off
// → bring it up with `up -d --wait` as before —— the safety property is unchanged,
// it just stops paying for a stack that's already fine.
// **Both clauses serve the same thing: no container may ever be replaced out from
// under a running test.**
//
// This really happened mid-full-run (2026-08-22): the machine got busy, the
// `payload-origin` health check (every 3s, spawning a python interpreter each
// time) flickered to unhealthy → this judged "stack not in order" → `up -d --wait`
// **rebuilt the backend** → the running cases died in a heap, and then 8
// `visitor-*` in a row all went red (all green when run alone). In other words:
// the fast path added to save time **got switched off by the flimsiest check in
// the whole compose exactly when the machine was busiest**, and the cost wasn't "a
// bit slower", it was the stack being swapped out from under the tests.
//
//   1. A flicker isn't a failure —— wait a beat and look again; only treat it as
//      real if it's off both times.
//   2. `--no-recreate` —— fill in what's missing, **touch nothing that's running**.
//      The fixture is a safety net, not a deploy tool; swapping images is
//      `make dev-up`'s job.
function ensureStackUp(): void {
  if (stackAlreadyUp()) return;
  execSync('sleep 2');
  if (stackAlreadyUp()) return;
  execSync(`docker compose ${COMPOSE} up -d --wait --no-recreate`, { stdio: 'inherit' });
}

// stackAlreadyUp —— every service compose defines has a running container, and
// every one with a health check is healthy. The criterion is taken from compose's
// own service list (not a hardcoded set of names): if you add a service and forget
// to change this, the result is a **fall back to the slow path**, not a missed check.
function stackAlreadyUp(): boolean {
  try {
    const running = new Map<string, PSRow>();
    psRows().forEach((r) => { r.State === 'running' && running.set(r.Service, r); });
    return definedServices().every((s) => {
      const row = running.get(s);
      // Empty Health = this service has no health check configured, so running is
      // the whole signal it can give.
      return row !== undefined && (row.Health === '' || row.Health === 'healthy');
    });
  } catch {
    return false; // compose can't answer → take the slow path and let it report the error
  }
}

interface PSRow { Service: string; State: string; Health: string }

// psRows —— `ps --format json` gives one object per line (newer compose); older
// versions give a single array. Accept both.
function psRows(): PSRow[] {
  const out = execSync(`docker compose ${COMPOSE} ps --format json`, { encoding: 'utf-8' }).trim();
  if (out === '') return [];
  if (out.startsWith('[')) return JSON.parse(out) as PSRow[];
  return out.split('\n').map((line) => JSON.parse(line) as PSRow);
}

// definedServices —— the service names declared in the compose file. Asked once
// per worker process: the file doesn't change during a run, and this exec also
// takes a few hundred ms.
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

// unclaim —— UPDATE the singleton's single row back to is_claimed=false. Leaves
// setup_token_hash alone (the claim flow already cleared it to NULL; the backend's
// next /api/v1/instance self-heals and re-issues a token, syncing holder + DB hash
// to a new plaintext).
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

// execSQL —— run a statement without reading its result. Used to **manufacture a
// precondition state** (e.g. a usage row from 8 days ago), a state no API can
// create: there's no "wind the clock back" endpoint, nor should there be.
export function execSQL(sql: string): void {
  runPsql(sql.replaceAll('"', '\\"'));
}

// ⚠️ There used to be an `applyMigration(name)` here: it read
// `backend/db/migrations/<name>.sql` and ran it against the DB with psql. Upgrade
// tests relied on it to apply the migration.
//
// **It made that test run on a path prod doesn't have.** In a real instance nobody
// does this step —— migrations are applied by the backend itself at startup
// (`pgstore.Migrate`, compiled into the same binary). So that test proved "this
// .sql file is written correctly", while **how an upgrade reaches an instance** was
// done by the test on its behalf: the part that actually breaks was never walked.
//
// Deleting it leaves the upgrade test one path to run —— `restartBackend()`, which
// is the deployment itself. Same family: [[which-path-is-the-green-on]].

// querySQL —— run a query and return the raw value (single row, single column,
// -tA). Use it to assert "is this row still there".
export function querySQL(sql: string): string {
  return execSync(
    `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -tA -c ` +
    `"${sql.replaceAll('"', '\\"')}"`,
    { encoding: 'utf-8' },
  ).trim();
}

// backendLogTail —— fetch the backend's last n lines of logs.
//
// Some invariants **hold or fail only in the logs** —— e.g. "however many tool
// calls were dispatched in a turn, there should be that many individually
// attributable results" (F-S-1). That's invisible in the UI and unreadable via the
// API; the log is the thing the assertion is really about. A case that uses it must
// spell out in its own comment why this assertion can't go through the product's surface.
export function backendLogTail(lines = 400): string {
  return execSync(`docker compose ${COMPOSE} logs --tail ${lines} backend`, {
    encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024,
  });
}

// setSearchDegraded —— push the backend into / out of **search degradation** (drop
// Meili, fall back to Postgres full-text).
//
// The switch is read at startup (empty `MEILI_URL` → `search.New` returns nil,
// boot_deps.go:142), so this is a container rebuild, not a runtime flag. A case
// that uses it must restore in afterAll —— leaving degradation on makes every later
// search case run on the other path, and they'll go green anyway (which is exactly
// why F-S-3 went undiscovered for so long).
export function setSearchDegraded(on: boolean): void {
  execSync(`make -C .. ${on ? 'dev-pgsearch-on' : 'dev-pgsearch-off'}`, { stdio: 'inherit' });
}

// restartBackend —— make the backend process start over. A periodic task's first
// run is at boot, so "clear the stale rows once on startup" can only be observed
// via a restart. Goes through the Makefile (the single entry point for all docker ops).
export function restartBackend(): void {
  execSync('make -C .. dev-restart-svc SVC=backend', { stdio: 'inherit' });
}

// findSetupToken —— get the plaintext setup token the backend currently holds.
// Via an HTTP fetch of /api/v1/instance; while unclaimed the backend self-heals and
// always returns a plaintext that matches the DB hash.
//
// Sync wrapper around an HTTP fetch via curl —— most spec helpers are sync
// (resetInstance + findSetupToken are both called non-async in beforeAll), so it
// uses execSync(curl) to get the JSON and then parses it.
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
