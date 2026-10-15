// periodic.ts —— run a periodic job now and wait for that run to complete.
//
// Contract: tasks.run_periodic {name} enqueues one run; tasks.periodic reports each periodic job's
// last_run_at and last_result. A run is finished when last_run_at moved and last_result is completed.

import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

interface Ctx { request: APIRequestContext; apiToken: string; sid: string }
interface Periodic { name: string; last_run_at?: string; last_result?: string }

async function lastRun(c: Ctx, name: string): Promise<Periodic | undefined> {
  const out = await callTool<{ periodic: Periodic[] }>(c.request, c.apiToken, c.sid, 'tasks.periodic', {});
  return out.periodic.find((p) => p.name === name);
}

/** Run the named periodic job now and wait until that run completed. */
export async function runPeriodicNow(c: Ctx, name: string): Promise<void> {
  const before = (await lastRun(c, name))?.last_run_at ?? '';
  await callTool(c.request, c.apiToken, c.sid, 'tasks.run_periodic', { name });
  await expect.poll(async () => {
    const s = await lastRun(c, name);
    return s?.last_run_at !== undefined && s.last_run_at !== before && s.last_result === 'completed';
  }, { timeout: 60_000, message: `the periodic job "${name}" never completed` }).toBe(true);
}
