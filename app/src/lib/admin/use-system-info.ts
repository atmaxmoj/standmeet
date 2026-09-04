// use-system-info —— #101 data layer for /admin/system. GET /api/admin/system
// fetches real version / uptime / go runtime + real health pings. Read-only,
// fetched once on mount.

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const HealthCheckSchema = z.object({
  name: z.string(),
  detail: z.string(),
  ok: z.boolean(),
});
const ContainerSchema = z.object({
  name: z.string(),
  cpu_percent: z.number(),
  mem_bytes: z.number(),
  mem_limit: z.number(),
});
const SystemInfoSchema = z.object({
  version: z.string(),
  public_ip: z.string(),
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
  containers: z.array(ContainerSchema),
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
  // status —— for ListPane, so a panel can tell "still loading / failed" from a real empty
  // (the cluster panel needs this: an empty container list must not read as "no data" while
  // the fetch is still in flight or failed).
  status: ResourceStatus;
}

export function useSystemInfo(): SystemInfoHook {
  const { data, status, ensureLoaded } = systemStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { info: data ?? null, loading: status === 'loading', status };
}

// formatUptime —— seconds → a compact display like "2h 13m" / "45s".
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// deployView —— info → deployment row display strings (null → placeholder). Lives here so the component has no branches.
export function deployView(
  info: SystemInfo | null,
): { version: string; cpus: string; uptime: string; ip: string } {
  if (info === null) {
    return { version: '—', cpus: '—', uptime: '—', ip: '—' };
  }
  return {
    version: info.version,
    cpus: String(info.num_cpu),
    uptime: formatUptime(info.uptime_seconds),
    ip: info.public_ip === '' ? '—' : info.public_ip,
  };
}

// ClusterRowView —— one container's usage row for the cluster panel. cpu/mem are folded into
// one `usage` string here so the component renders no separator literal (i18n-lint clean).
export interface ClusterRowView {
  name: string;
  usage: string;
}

function mb(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)));
}

function memText(bytes: number, limit: number): string {
  return limit > 0 ? `${mb(bytes)} / ${mb(limit)} MB` : `${mb(bytes)} MB`;
}

// clusterRows —— info → per-container rows (own compose project). Empty (no docker socket /
// not wired) gives no rows, so the panel shows its own "no cluster data" placeholder.
export function clusterRows(info: SystemInfo | null): ClusterRowView[] {
  if (info === null) {
    return [];
  }
  return info.containers.map((c) => ({
    name: c.name,
    usage: `${c.cpu_percent.toFixed(1)}% cpu · ${memText(c.mem_bytes, c.mem_limit)}`,
  }));
}

// healthList —— info → health rows (empty/not loaded gives one loading placeholder row).
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

// resourceStats —— info → resource rows (host disk/mem/load + go runtime).
// Lives here so the component has no branches.
// null (not loaded) gives placeholders throughout; branching/formatting all live in lib.
export function resourceStats(info: SystemInfo | null): ResourceStatView[] {
  if (info === null) {
    return [
      { label: 'disk', value: '—', sub: 'used / total' },
      { label: 'host mem', value: '—', sub: 'used / total' },
      { label: 'cpu load', value: '—', sub: '1min avg' },
      { label: 'goroutines', value: '—', sub: 'live' },
      { label: 'go heap', value: '—', sub: 'mb alloc' },
    ];
  }
  return [
    {
      // used / total, like the host-mem row below — the backend sends free, so used = total - free.
      // Showing free here (with the same `X / Y` shape mem uses for used) read as a contradiction:
      // "54.6 / 144.2" looks like used, next to "38% free" it doesn't add up. df's convention is used.
      label: 'disk',
      value: `${gb(info.disk_total_mb - info.disk_free_mb)} / ${gb(info.disk_total_mb)} GB`,
      sub: `${pct(info.disk_total_mb - info.disk_free_mb, info.disk_total_mb)} used`,
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
