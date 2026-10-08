// use-trash —— the corpus trash (GET /corpus-trash) and its restore action.
//
// A restore puts entries back into whichever genre list they came from, so after one every corpus
// list that is already loaded reloads, and the shared corpus invalidation (tree + counts) runs.

'use client';

import { z } from 'zod';

import { onCorpusChanged } from '@/lib/admin/corpus-changed';
import { outputPage } from '@/lib/admin/use-output';
import { refreshRaw } from '@/lib/admin/use-raw';
import { subjectivityPage } from '@/lib/admin/use-subjectivity';
import { wikiPage } from '@/lib/admin/use-wiki';
import { adminAPI } from '@/lib/api/admin';
import { reloadIfLoaded } from '@/lib/state/create-paged-store';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const TrashItemSchema = z.object({
  id: z.string(),
  genre: z.string(),
  title: z.string(),
  deleted_at: z.string(),
  purge_at: z.string(),
  descendants: z.number(),
});
export type TrashItem = z.infer<typeof TrashItemSchema>;

const TrashRespSchema = z.object({ items: z.array(TrashItemSchema) });
const RestoreRespSchema = z.object({ restored: z.array(z.string()) });

const trashStore = createResourceStore<TrashItem[]>({
  name: 'corpus-trash',
  fetcher: () => adminAPI.get('/corpus-trash', TrashRespSchema).then((r) => r.items),
});

export interface TrashHook {
  items: readonly TrashItem[];
  status: ResourceStatus;
  error: string | null;
  refresh: () => Promise<void>;
  restore: (id: string) => Promise<void>;
}

export function useTrash(): TrashHook {
  const { data, status, error, refresh } = trashStore();
  return {
    items: data ?? [],
    status,
    error,
    refresh,
    restore: async (id) => {
      await adminAPI.post(`/corpus-trash/${encodeURIComponent(id)}/restore`, {}, RestoreRespSchema);
      onCorpusChanged();
      await Promise.all([
        refresh(), refreshRaw(),
        reloadIfLoaded(wikiPage), reloadIfLoaded(outputPage), reloadIfLoaded(subjectivityPage),
      ]);
    },
  };
}

// trashDate —— the day part of an RFC 3339 timestamp.
export function trashDate(iso: string): string {
  return iso.slice(0, 10);
}
