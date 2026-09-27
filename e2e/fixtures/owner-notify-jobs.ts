// owner-notify-jobs.ts —— the owner.notify jobs (docs/design/event-bus-outbox-webhooks.md,
// *Completion hooks*). An owner notification is a durable job that runs after the request that
// caused it returned, so a spec that counts mails first waits for this job to reach its end state:
// then every mail it will ever send has been sent, and the count is final.

import type { APIRequestContext } from '@playwright/test';

import { expect } from '@/fixtures/test';
import { callTool } from '@/fixtures/mcp';

interface NotifyJob { id: number; state: string }

async function notifyJobs(
  request: APIRequestContext, token: string, sid: string, limit: number,
): Promise<NotifyJob[]> {
  const out = await callTool<{ jobs: NotifyJob[] }>(
    request, token, sid, 'tasks.list', { kind: 'owner.notify', limit },
  );
  return out.jobs;
}

// lastNotifyJob —— the newest owner.notify job id before the spec acts (0 = none): the jobs the
// spec causes are the ones after it.
export async function lastNotifyJob(
  request: APIRequestContext, token: string, sid: string,
): Promise<number> {
  return (await notifyJobs(request, token, sid, 1))[0]?.id ?? 0;
}

// waitForNotifyJobs —— waits until the owner.notify jobs after `anchor` are exactly `states`.
export async function waitForNotifyJobs(
  request: APIRequestContext, token: string, sid: string, anchor: number, states: string[],
): Promise<void> {
  await expect
    .poll(async () => (await notifyJobs(request, token, sid, 100))
      .filter((j) => j.id > anchor).map((j) => j.state).sort().join(','), {
      message: `owner.notify jobs after ${anchor} reach ${states.join(',')}`,
      timeout: 60_000,
    })
    .toBe([...states].sort().join(','));
}
