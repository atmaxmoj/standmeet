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
