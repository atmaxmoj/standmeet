// use-jobs —— Monitor/SystemSection background-jobs 数据层。GET /api/admin/stats/jobs 拿真 cron
// 登记表（目前唯一真任务:沙箱工作区 sweep）+ last-run/status。只读,mount 拉一次。格式化在这
// (lib),组件无 if。诚实:只列真正在跑的 job,不再硬编 sitemap/reindex/backup。

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';

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

// lastRunView —— ISO last_run → 紧凑本地时间；null(没跑过)→ '—'。
function lastRunView(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// jobRowViews —— jobs → 表格行显示串。空(子系统未起)→ 一条诚实占位行,非假 job。
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
