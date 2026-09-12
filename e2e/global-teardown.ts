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
import { DB_CONTAINER } from './fixtures/instance';

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

// dropBlockSchemas —— every per-block document store this run provisioned.
//
// Safe to drop: `blockstore` creates a block's schema on demand and `BlockStorageInit` reprovisions
// at boot, so the next run rebuilds whatever it needs. What does NOT come back on its own is the
// schema of a block that only ever existed inside one test — those are pure leak.
async function dropBlockSchemas(): Promise<void> {
  const list = await psql(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mcp\\_%' ORDER BY nspname`,
  );
  const schemas = list.split('\n').map((s) => s.trim()).filter(Boolean);
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
