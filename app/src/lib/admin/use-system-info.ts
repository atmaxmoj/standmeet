// use-system-info —— #101 /admin/system 数据层。GET /api/admin/system 拿真 version /
// uptime / go runtime + 真 health ping。只读,mount 时拉一次。

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';

const HealthCheckSchema = z.object({
  name: z.string(),
  detail: z.string(),
  ok: z.boolean(),
});
const SystemInfoSchema = z.object({
  version: z.string(),
  uptime_seconds: z.number(),
  goroutines: z.number(),
  mem_alloc_mb: z.number(),
  num_cpu: z.number(),
  disk_total_mb: z.number(),
  disk_free_mb: z.number(),
  mem_total_mb: z.number(),
  mem_used_mb: z.number(),
  load_avg_1: z.number(),
  health: z.array(HealthCheckSchema),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

const systemStore = createResourceStore<SystemInfo>({
  name: 'system-info',
  fetcher: () => adminAPI.get('/system', SystemInfoSchema),
});

export interface SystemInfoHook {
  info: SystemInfo | null;
  loading: boolean;
}

export function useSystemInfo(): SystemInfoHook {
  const { data, status, ensureLoaded } = systemStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { info: data ?? null, loading: status === 'loading' };
}

// formatUptime —— 秒 → "2h 13m" / "45s" 之类的紧凑显示。
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// deployView —— info → deployment 行显示串(null → 占位)。放这里让组件不含分支。
export function deployView(
  info: SystemInfo | null,
): { version: string; cpus: string; uptime: string } {
  if (info === null) {
    return { version: '—', cpus: '—', uptime: '—' };
  }
  return {
    version: info.version,
    cpus: String(info.num_cpu),
    uptime: formatUptime(info.uptime_seconds),
  };
}

// healthList —— info → health 行(空/未加载给一条 loading 占位)。
export function healthList(info: SystemInfo | null): HealthCheck[] {
  if (info === null || info.health.length === 0) {
    return [{ name: '—', detail: 'loading…', ok: true }];
  }
  return info.health;
}

export interface ResourceStatView {
  label: string;
  value: string;
  sub: string;
}

function gb(mb: number): string {
  return (mb / 1024).toFixed(1);
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

// resourceStats —— info → 资源行(主机 disk/mem/load + go runtime)。放这里让组件不含分支。
// null(未加载)全给占位;分支/格式化都在 lib。
export function resourceStats(info: SystemInfo | null): ResourceStatView[] {
  if (info === null) {
    return [
      { label: 'disk', value: '—', sub: 'free / total' },
      { label: 'host mem', value: '—', sub: 'used / total' },
      { label: 'cpu load', value: '—', sub: '1min avg' },
      { label: 'goroutines', value: '—', sub: 'live' },
      { label: 'go heap', value: '—', sub: 'mb alloc' },
    ];
  }
  return [
    {
      label: 'disk',
      value: `${gb(info.disk_free_mb)} / ${gb(info.disk_total_mb)} GB`,
      sub: `${pct(info.disk_free_mb, info.disk_total_mb)} free`,
    },
    {
      label: 'host mem',
      value: `${gb(info.mem_used_mb)} / ${gb(info.mem_total_mb)} GB`,
      sub: `${pct(info.mem_used_mb, info.mem_total_mb)} used`,
    },
    { label: 'cpu load', value: info.load_avg_1.toFixed(2), sub: '1min avg' },
    { label: 'goroutines', value: String(info.goroutines), sub: 'live' },
    { label: 'go heap', value: String(info.mem_alloc_mb), sub: 'mb alloc' },
  ];
}
