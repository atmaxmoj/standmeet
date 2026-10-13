// retention.ts —— the ephemeral clock's daily sweep, run on demand and waited on
// (docs/design/job-loop-retention.md).
//
// Contract:
//   tasks.run_periodic {name: 'retention sweep'} enqueues one run; tasks.periodic reports each
//   periodic job's last_run_at and last_result. A sweep is finished when its last_run_at moved
//   and its last_result is completed. Its audit record (retention.bundle_cleared) is written in
//   the same transaction as the clearing, so "finished, and no new record" means "nothing cleared".

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

interface Ctx { request: APIRequestContext; apiToken: string; sid: string }
interface Periodic { name: string; last_run_at?: string; last_result?: string }

const SWEEP = 'retention sweep';

async function lastSweep(c: Ctx): Promise<Periodic | undefined> {
  const out = await callTool<{ periodic: Periodic[] }>(c.request, c.apiToken, c.sid, 'tasks.periodic', {});
  return out.periodic.find((p) => p.name === SWEEP);
}

/** Run the sweep now and wait until that run completed. */
export async function sweepRetention(c: Ctx): Promise<void> {
  const before = (await lastSweep(c))?.last_run_at ?? '';
  await callTool(c.request, c.apiToken, c.sid, 'tasks.run_periodic', { name: SWEEP });
  await expect.poll(async () => {
    const s = await lastSweep(c);
    return s?.last_run_at !== undefined && s.last_run_at !== before && s.last_result === 'completed';
  }, { timeout: 60_000, message: 'the retention sweep never completed' }).toBe(true);
}

/** How many retention.bundle_cleared audit records the owner can read. */
export async function clearedRecords(c: Ctx): Promise<number> {
  const out = await callTool<{ events: unknown[] }>(c.request, c.apiToken, c.sid, 'events.list',
    { type: 'retention.bundle_cleared', limit: 200 });
  return out.events.length;
}
