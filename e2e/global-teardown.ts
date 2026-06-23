// global-teardown —— 跑完 e2e dump backend container 日志到
// test-results/backend.log。诊断失败的 test 不用 ad-hoc tail compose log，
// 直接读这个文件。
//
// 时间窗：整个 run。test 失败时按 test name + step 时间戳在 backend.log 里
// 搜，比每个 test 单独 attach 一段日志更简单也更可读。

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
