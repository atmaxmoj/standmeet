// use-capabilities —— Phase H data layer for the admin panel's "capabilities".
//
// One fetched resource (GET /api/admin/capabilities, lists every capability +
// connector + skill) + two mutations (PATCH the owner-enable toggle, DELETE
// for owner-origin only). Follows the createResourceStore + facade shape used
// by the other connector hooks, refreshing after a mutation to get the latest.

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
  // title —— human-readable display name (the #109/#110 dock button dropdown label). Absent if the capability didn't declare one.
  title: z.string().optional(),
  origin: z.enum(['builtin', 'managed', 'owner']),
  kind: z.enum(['capability', 'connector', 'skill']),
  enabled: z.boolean(),
  deletable: z.boolean(),
  dependency: CapabilityDependencySchema.optional(),
});
export type CapabilityRow = z.infer<typeof CapabilityRowSchema>;

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

// dependencyHint —— plain-language hint when a connector dependency isn't met (calendar.book needs a calendar connected).
export function dependencyHint(row: CapabilityRow): string | null {
  if (!row.dependency || row.dependency.connected) return null;
  return `needs ${row.dependency.name} — not connected`;
}
