// use-capabilities —— Phase H 管理面「能力」数据层。
//
// 一个 fetched resource（GET /api/admin/capabilities，列全部 capability +
// connector + skill）+ 两个 mutation（PATCH owner-enable 开关、DELETE 仅
// owner-origin）。沿用别的 connector hook 的 createResourceStore + facade 形态，
// mutation 后 refresh 拿最新。

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── schema ────────────────────────────────────────────────────

const CapabilityDependencySchema = z.object({
  name: z.string(),
  connected: z.boolean(),
});

const CapabilityRowSchema = z.object({
  id: z.string(),
  origin: z.enum(['builtin', 'managed', 'owner']),
  kind: z.enum(['capability', 'connector', 'skill']),
  enabled: z.boolean(),
  deletable: z.boolean(),
  dependency: CapabilityDependencySchema.optional(),
});
export type CapabilityRow = z.infer<typeof CapabilityRowSchema>;
export type CapabilityOrigin = CapabilityRow['origin'];
export type CapabilityKind = CapabilityRow['kind'];

const CapabilitiesRespSchema = z.object({
  capabilities: z.array(CapabilityRowSchema),
});

// ─── store ─────────────────────────────────────────────────────

const capabilitiesStore = createResourceStore<CapabilityRow[]>({
  name: 'capabilities',
  fetcher: () =>
    adminAPI.get('/capabilities', CapabilitiesRespSchema).then((r) => r.capabilities),
});

// ─── facade ────────────────────────────────────────────────────

export interface CapabilitiesHook {
  rows: readonly CapabilityRow[];
  status: ResourceStatus;
  ensureLoaded: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useCapabilities(): CapabilitiesHook {
  const { data, status, ensureLoaded, refresh } = capabilitiesStore();
  return {
    rows: data ?? [],
    status,
    ensureLoaded,
    setEnabled: async (id, enabled) => {
      await adminAPI.patchVoid(`/capabilities/${encodeURIComponent(id)}`, { enabled });
      await refresh();
    },
    remove: async (id) => {
      await adminAPI.deleteVoid(`/capabilities/${encodeURIComponent(id)}`);
      await refresh();
    },
  };
}

// ─── view helpers ──────────────────────────────────────────────

// originLabel —— 徽章文案（设计：mono 小写标签）。
export function originLabel(origin: CapabilityOrigin): string {
  return origin;
}

// dependencyHint —— connector 依赖未满足时的人话提示（calendar.book 需连日历）。
export function dependencyHint(row: CapabilityRow): string | null {
  if (!row.dependency || row.dependency.connected) return null;
  return `needs ${row.dependency.name} — not connected`;
}
