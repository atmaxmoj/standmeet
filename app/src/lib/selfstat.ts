// selfstat — read THIS app container's OWN resource usage from its cgroup v2 files (no docker
// socket). The backend gathers this plus its own for the admin System panel. The Go twin is
// backend/internal/infra/selfstat; the JSON shape (SelfStat) matches its Stat.

import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

const ROOT = '/sys/fs/cgroup';
const SAMPLE_MS = 400;
const USAGE_PREFIX = 'usage_usec ';
const USEC_PER_MS = 1000;
const PCT = 100;

export interface SelfStat {
  name: string;
  cpu_percent: number;
  mem_bytes: number;
  mem_limit: number;
}

async function readTrimmed(file: string): Promise<string> {
  return (await readFile(`${ROOT}/${file}`, 'utf8')).trim();
}

// "max" (no limit set) → 0, so the panel shows absolute MB rather than dividing by a bogus limit.
async function readMemLimit(): Promise<number> {
  const raw = await readTrimmed('memory.max');
  return raw === 'max' ? 0 : Number.parseInt(raw, 10);
}

// usageUsec — the container's total CPU microseconds, from cpu.stat's `usage_usec N` line.
async function usageUsec(): Promise<number> {
  const line = (await readTrimmed('cpu.stat')).split('\n').find((l) => l.startsWith(USAGE_PREFIX));
  const raw = line?.slice(USAGE_PREFIX.length).trim() ?? '';
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? Promise.reject(new Error('cpu.stat: no usage_usec')) : n;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// cpuPct — delta CPU microseconds over the wall window, as percent of one core (a busy multi-core
// service reads above 100, the same convention as `docker stats`); guarded to 0 on no movement.
function cpuPct(deltaUsec: number, wallUsec: number): number {
  return wallUsec > 0 && deltaUsec > 0 ? (deltaUsec / wallUsec) * PCT : 0;
}

// read — one snapshot: memory now + CPU% sampled over SAMPLE_MS. Rejects when the cgroup files
// aren't there (non-linux / not mounted), so the caller returns "unavailable" rather than fake 0s.
export async function read(): Promise<SelfStat> {
  const name = process.env.STANDMEET_SERVICE_NAME ?? hostname();
  const mem_bytes = Number.parseInt(await readTrimmed('memory.current'), 10);
  const mem_limit = await readMemLimit();
  const u1 = await usageUsec();
  const t1 = Date.now();
  await wait(SAMPLE_MS);
  const u2 = await usageUsec();
  const cpu_percent = cpuPct(u2 - u1, (Date.now() - t1) * USEC_PER_MS);
  return { name, cpu_percent, mem_bytes, mem_limit };
}
