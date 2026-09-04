// global-teardown —— after the e2e run, dump the backend container logs to
// test-results/backend.log. To diagnose a failed test, read this file directly instead of
// ad-hoc tailing the compose log.
//
// Time window: the whole run. When a test fails, search backend.log by test name + step
// timestamp, which is simpler and more readable than attaching a log slice to each test.

import { exec } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'test-results', 'backend.log');

export default async function dumpBackendLog(): Promise<void> {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await dumpService('backend', OUT);
  await dumpService('llm-gateway', path.join(__dirname, 'test-results', 'gateway.log'));
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
