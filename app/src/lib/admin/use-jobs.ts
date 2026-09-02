// use-jobs —— data layer for the Monitor/SystemSection background-jobs panel.
// GET /api/admin/stats/jobs fetches the real cron registry (currently the
// only real job: sandbox workspace sweep) + last-run/status. Read-only,
// fetched once on mount. Formatting lives here (lib), the component has no
// if. Honest: lists only jobs actually running, no longer hardcodes
// sitemap/reindex/backup.

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import { ago } from '@/lib/ui/format-time';

const ScheduledJobSchema = z.object({
  name: z.string(),
  schedule: z.string(),
  last_run: z.string().nullable(),
  last_status: z.string(),
});
const JobsSchema = z.object({ jobs: z.array(ScheduledJobSchema) });
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

const jobsStore = createResourceStore<{ jobs: ScheduledJob[] }>({
  name: 'scheduled-jobs',
  fetcher: () => adminAPI.get('/stats/jobs', JobsSchema),
});

export interface JobsHook {
  jobs: ScheduledJob[];
  loading: boolean;
}

export function useScheduledJobs(): JobsHook {
  const { data, status, ensureLoaded } = jobsStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { jobs: data?.jobs ?? [], loading: status === 'loading' };
}

export interface JobRowView {
  name: string;
  schedule: string;
  last: string;
  status: string;
}

// lastRunView —— ISO last_run → "how long ago"; null (never run) → '—'.
// It used to give a time like `10:16 AM` that only reads meaningfully within
// a day: something run yesterday and something run today look identical (UX-46).
function lastRunView(iso: string | null): string {
  return iso === null ? '—' : ago(iso);
}

// jobRowViews —— jobs → table row display strings. Empty (subsystem not up) → one honest placeholder row, not a fake job.
export function jobRowViews(jobs: ScheduledJob[]): JobRowView[] {
  if (jobs.length === 0) {
    return [{ name: 'no scheduled jobs', schedule: '—', last: '—', status: 'idle' }];
  }
  return jobs.map((j) => ({
    name: j.name,
    schedule: j.schedule,
    last: lastRunView(j.last_run),
    status: j.last_status,
  }));
}
