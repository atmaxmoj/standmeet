// retention.ts —— the ephemeral clock's daily sweep, run on demand and waited on
// (docs/design/job-loop-retention.md).
//
// Contract: the sweep is the periodic job "retention sweep" (fixtures/periodic.ts runs it). Its audit
// record (retention.bundle_cleared) is written in the same transaction as the clearing, so
// "finished, and no new record" means "nothing cleared".

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';
import { runPeriodicNow } from '@/fixtures/periodic';

interface Ctx { request: APIRequestContext; apiToken: string; sid: string }

/** Run the sweep now and wait until that run completed. */
export function sweepRetention(c: Ctx): Promise<void> {
  return runPeriodicNow(c, 'retention sweep');
}

/** How many retention.bundle_cleared audit records the owner can read. */
export async function clearedRecords(c: Ctx): Promise<number> {
  const out = await callTool<{ events: unknown[] }>(c.request, c.apiToken, c.sid, 'events.list',
    { type: 'retention.bundle_cleared', limit: 200 });
  return out.events.length;
}
