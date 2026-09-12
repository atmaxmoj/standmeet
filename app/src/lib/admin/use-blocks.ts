// use-blocks —— the data layer for the admin panel's block list.
//
// One fetched resource (GET /api/admin/blocks, lists every block +
// supplier + skill) + two mutations (PATCH the owner-enable toggle, DELETE
// for owner-origin only). Follows the createResourceStore + facade shape used
// by the other admin hooks, refreshing after a mutation to get the latest.

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── schema ────────────────────────────────────────────────────

const BlockDependencySchema = z.object({
  name: z.string(),
  connected: z.boolean(),
});

const BlockRowSchema = z.object({
  id: z.string(),
  // title —— human-readable display name (the #109/#110 dock button dropdown label). Absent if the block didn't declare one.
  title: z.string().optional(),
  origin: z.enum(['builtin', 'managed', 'owner']),
  kind: z.enum(['block', 'supplier', 'skill']),
  enabled: z.boolean(),
  deletable: z.boolean(),
  // grants —— what this block reaches, by name (today: "net"). Only what it HAS: a
  // block with no network carries an empty list, because omission fails closed and
  // there is no "net: off" to render. Optional so a surface that predates the field
  // still parses rather than blanking the whole panel ([[zod-unknown-is-not-optional]]).
  grants: z.array(z.string()).optional(),
  dependency: BlockDependencySchema.optional(),
});
export type BlockRow = z.infer<typeof BlockRowSchema>;

const BlocksRespSchema = z.object({
  blocks: z.array(BlockRowSchema),
});

// ─── store ─────────────────────────────────────────────────────

const blocksStore = createResourceStore<BlockRow[]>({
  name: 'blocks',
  fetcher: () => adminAPI.get('/blocks', BlocksRespSchema).then((r) => r.blocks),
});

// refreshBlocks —— re-read the list from outside React.
//
// Installing a block adds a row, and the code that installs one lives in a
// different hook. Without this the block is installed, mounted and working, and simply
// missing from the only list that could put it in a bundle until the owner reloads.
//
// Exported as a function rather than by handing out the store: the one thing another
// module needs is "the list is stale, go again", and a store handle would also let it
// write, which is how two hooks end up disagreeing about the same rows.
export async function refreshBlocks(): Promise<void> {
  await blocksStore.getState().refresh();
}

// ─── facade ────────────────────────────────────────────────────

export interface BlocksHook {
  rows: readonly BlockRow[];
  status: ResourceStatus;
  ensureLoaded: () => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useBlocks(): BlocksHook {
  const { data, status, ensureLoaded, refresh } = blocksStore();
  return {
    rows: data ?? [],
    status,
    ensureLoaded,
    setEnabled: async (id, enabled) => {
      await adminAPI.patchVoid(`/blocks/${encodeURIComponent(id)}`, { enabled });
      await refresh();
    },
    remove: async (id) => {
      await adminAPI.deleteVoid(`/blocks/${encodeURIComponent(id)}`);
      await refresh();
    },
  };
}

// ─── view helpers ──────────────────────────────────────────────

// dependencyHint —— plain-language hint when a seam dependency isn't met (calendar.book needs a calendar connected).
export function dependencyHint(row: BlockRow): string | null {
  if (!row.dependency || row.dependency.connected) return null;
  return `needs ${row.dependency.name} — not connected`;
}
