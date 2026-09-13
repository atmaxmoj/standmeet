// global-teardown —— two jobs after a run: capture the logs, and **hand the machine back in the
// shape it was lent in**.
//
// 1. dump backend + gateway logs to test-results/, so a failure is diagnosed by reading a file
//    rather than by tailing compose after the fact.
// 2. drop what the run created and nothing else cleans up.
//
// Why (2) exists: `resetInstance()` runs per spec and TRUNCATEs the core tables, but the things a
// run leaves behind are not rows in those tables. Measured after one full round: **206 MB** of
// meilisearch index, **55 MB** of microsite build output, 35 MB in minio, and one postgres schema
// per block a test ever installed — `mcp_acme_widget_zzfixture`, created by a fixture block, was
// still there after `dev-down && dev-up`, because it lives in the volume.
//
// That accumulation is the reason a machine that runs two full suites happily gets slower and
// slower afterwards: it is not only kernel cache the VM can reclaim, it is real bytes in volumes
// that only ever grow.
//
// **It reports what it dropped.** A cleanup with no receipt is indistinguishable from one that
// silently matched nothing ([[write-with-no-receipt]]) — and this one matches by pattern, which is
// exactly the kind of thing that goes quietly blind after a rename.
import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'test-results', 'backend.log');

// Which stack this teardown may touch comes from the SAME place the specs get it
// (`fixtures/instance.ts`, off COMPOSE_PROJECT_NAME). Deliberately not restated here: a second
// copy of "which project am I" is how a teardown ends up dropping schemas in another worktree's
// database.
import { DB_CONTAINER } from '@/fixtures/instance';

export default async function globalTeardown(): Promise<void> {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await dumpService('backend', OUT);
  await dumpService('llm-gateway', path.join(__dirname, 'test-results', 'gateway.log'));
  await dropBlockSchemas();
}

async function dumpService(service: string, out: string): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker compose -f docker-compose.dev.yml logs --no-color ${service}`,
      { cwd: REPO_ROOT, maxBuffer: 32 * 1024 * 1024 },
    );
    await fs.writeFile(out, stdout + (stderr ? '\n--- stderr ---\n' + stderr : ''));
  } catch (e) {
    await fs.writeFile(out, `[global-teardown] capture failed: ${String(e)}\n`);
  }
}

// dropBlockSchemas —— the per-block document stores a TEST created, and only those.
//
// It used to drop every `mcp_*` schema, reasoning that "`BlockStorageInit` reprovisions at boot, so
// the next run rebuilds whatever it needs". **That is only true if there IS a boot before the next
// run.** `make test-asis` drives the stack already up and restarts nothing, and `dev-up` leaves a
// healthy backend alone — so two runs in a row started with the SHIPPED blocks' storage deleted.
// The booker's store is where its config lives, so the next run's booking specs died at
// `policy set: 500` on `relation "mcp_calendar_book.records" does not exist`, and the red pointed
// at booking rather than at the teardown that had removed it.
//
// The sentence above kept its intent and lost its overreach: what leaks is "the schema of a block
// that only ever existed inside one test". A block that SHIPS owns its schema — the teardown is
// not its owner and does not get to delete it.
async function dropBlockSchemas(): Promise<void> {
  const list = await psql(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mcp\\_%' ORDER BY nspname`,
  );
  const shipped = await shippedBlockSchemas();
  const all = list.split('\n').map((s) => s.trim()).filter(Boolean);
  const schemas = all.filter((s) => !shipped.has(s));
  if (all.length > 0 && schemas.length === 0) {
    process.stdout.write(
      `[global-teardown] ${all.length} block schema(s), all shipped — kept, nothing leaked\n`,
    );
    return;
  }
  if (schemas.length === 0) {
    // Not necessarily clean: this is also what a pattern that no longer matches looks like.
    // Say which, so a rename cannot turn this step into a silent no-op.
    process.stdout.write('[global-teardown] no mcp_* block schemas found — nothing to drop\n');
    return;
  }
  for (const s of schemas) await psql(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
  process.stdout.write(
    `[global-teardown] dropped ${schemas.length} block schema(s): ${schemas.join(', ')}\n`,
  );
}

// shippedBlockSchemas —— the schema names belonging to blocks that ship with the product, derived
// from backend/blocks/*/manifest.yaml rather than listed here. A hand-kept list would be one more
// place to forget when a block is added, and forgetting would silently delete that block's storage
// out from under the next run — the same shape of defect this function exists to fix.
//
// The schema name is the block id with everything postgres will not take in an identifier folded
// to '_', mirroring blockstore's own idSuffixRe (`calendar.book` -> `mcp_calendar_book`).
async function shippedBlockSchemas(): Promise<Set<string>> {
  const dir = path.join(REPO_ROOT, 'backend', 'blocks');
  const out = new Set<string>();
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const body = await fs
      .readFile(path.join(dir, entry.name, 'manifest.yaml'), 'utf-8')
      .catch(() => '');
    const id = /^id:\s*(\S+)/m.exec(body)?.[1]?.replace(/["']/g, '');
    if (id !== undefined && id !== '') out.add(`mcp_${id.replace(/[^a-zA-Z0-9]/g, '_')}`);
  }
  return out;
}

async function psql(sql: string): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `docker exec ${DB_CONTAINER} psql -U standmeet -d standmeet -tAc "${sql.replaceAll('"', '\\"')}"`,
      { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 },
    );
    return stdout;
  } catch (e) {
    process.stdout.write(`[global-teardown] psql failed: ${String(e)}\n`);
    return '';
  }
}
