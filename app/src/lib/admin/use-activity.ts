// use-activity —— Monitor/ActivityTicker 数据层。GET /api/admin/stats/activity 拿从现有行派生的
// 最近事件（访客 / corpus 写入 / 预约），最新在前。只读,mount 拉一次。分支/格式化在这(lib),
// 让 ActivityTicker 组件保持无 if。诚实:无事件显 "no activity yet",不再编假事件流。

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';

const ActivityEventSchema = z.object({
  kind: z.string(),
  at: z.string(),
  label: z.string(),
});
const ActivitySchema = z.object({ events: z.array(ActivityEventSchema) });
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

const activityStore = createResourceStore<{ events: ActivityEvent[] }>({
  name: 'recent-activity',
  fetcher: () => adminAPI.get('/stats/activity', ActivitySchema),
});

export interface ActivityHook {
  events: ActivityEvent[];
  loading: boolean;
}

export function useRecentActivity(): ActivityHook {
  const { data, status, ensureLoaded } = activityStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { events: data?.events ?? [], loading: status === 'loading' };
}

const KIND_GLYPH: Record<string, string> = {
  visitor: '◆',
  ingest: '▲',
  booking: '●',
};

function kindGlyph(kind: string): string {
  return KIND_GLYPH[kind] ?? '▪';
}

// tickerLabels —— events → 流动 log 的每条串。空 → 一条诚实占位（非 "coming soon"）。
export function tickerLabels(events: ActivityEvent[]): string[] {
  if (events.length === 0) {
    return ['no activity yet'];
  }
  return events.map((e) => `${kindGlyph(e.kind)} ${e.label}`);
}
