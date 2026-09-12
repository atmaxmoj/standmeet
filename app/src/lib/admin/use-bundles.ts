// use-bundles —— the owner's assembly: install a block, group blocks into a bundle.
//
// `docs/design/plugin/frontend.md` §3 replaces a subtractive ACL — pick tools per role,
// then take them back per code, and answer "what can this code do" by reading three
// screens — with an additive one: choose blocks, name the group, point a code at it.
// This is the data layer for that.
//
// One store for bundles, refreshed after every mutation. Not optimistic: what a bundle
// contains decides what a live visitor can do, and a list that shows a block already
// removed is a list the owner would act on wrongly. The server's answer is the state.

'use client';

import { z } from 'zod';

import { refreshBlocks } from '@/lib/admin/use-blocks';
import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── schema ────────────────────────────────────────────────────

// BlockFailureSchema —— what a block said before it died.
//
// `stderr` is the field with teeth. A block that silently is not there is
// indistinguishable from one that was never installed, and "something went wrong" does
// not survive contact with a broken plugin — the owner needs the child's own words.
const BlockFailureSchema = z.object({
  block_id: z.string(),
  title: z.string(),
  stderr: z.string(),
});
const BundleSchema = z.object({
  name: z.string(),
  blocks: z.array(z.string()),
  failures: z.array(BlockFailureSchema),
});
export type Bundle = z.infer<typeof BundleSchema>;

const BundlesRespSchema = z.object({ bundles: z.array(BundleSchema) });

// ─── store ─────────────────────────────────────────────────────

const bundlesStore = createResourceStore<Bundle[]>({
  name: 'bundles',
  fetcher: () => adminAPI.get('/bundles', BundlesRespSchema).then((r) => r.bundles),
});

// ─── facade ────────────────────────────────────────────────────

export interface BundlesHook {
  bundles: readonly Bundle[];
  status: ResourceStatus;
  ensureLoaded: () => Promise<void>;
  create: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  addBlock: (name: string, blockID: string) => Promise<void>;
  removeBlock: (name: string, blockID: string) => Promise<void>;
  install: (manifest: string) => Promise<void>;
}

export function useBundles(): BundlesHook {
  const { data, status, ensureLoaded, refresh } = bundlesStore();
  return {
    bundles: data ?? [],
    status,
    ensureLoaded,
    create: async (name) => {
      await adminAPI.postVoid('/bundles', { name });
      await refresh();
    },
    remove: async (name) => {
      await adminAPI.deleteVoid(`/bundles/${encodeURIComponent(name)}`);
      await refresh();
    },
    addBlock: async (name, blockID) => {
      await adminAPI.postVoid(
        `/bundles/${encodeURIComponent(name)}/blocks`, { block_id: blockID },
      );
      await refresh();
    },
    removeBlock: async (name, blockID) => {
      await adminAPI.deleteVoid(
        `/bundles/${encodeURIComponent(name)}/blocks/${encodeURIComponent(blockID)}`,
      );
      await refresh();
    },
    // install —— refreshes BOTH lists, and the block one is the load-bearing half.
    //
    // A freshly installed block is a new row, and the bundle editor offers
    // blocks from that row list: without this the block is installed, mounted and
    // working, and simply absent from the only screen that could add it to a bundle
    // until the owner reloads the page. Bundles refresh too, because a re-install
    // clears that block's failure and the health line reporting it is on this screen.
    install: async (manifest) => {
      await adminAPI.postVoid('/blocks', { manifest });
      await Promise.all([refresh(), refreshBlocks()]);
    },
  };
}
