// use-microsite-store —— the owner's management view of one microsite's data store (the
// per-page NoSQL namespace visitors write into). Backed by the admin store routes:
//   GET    /api/admin/microsites/{slug}/store                          → one page of docs, newest first
//   DELETE /api/admin/microsites/{slug}/store/{collection}/{record_id} → delete one
//   DELETE /api/admin/microsites/{slug}/store                          → clear the store

import { useCallback, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import {
  createPagedStore, usePaged, type PagedState, type PagedStore,
} from '@/lib/state/create-paged-store';
import type { ResourceStatus } from '@/lib/state/status';

const StoreDocSchema = z.object({
  id: z.string(),
  collection: z.string(),
  // doc is opaque JSON the page defined — keep it as-is for display.
  doc: z.unknown(),
});
export type StoreDoc = z.infer<typeof StoreDocSchema>;

export interface MicrositeStoreHook {
  docs: readonly StoreDoc[];
  status: ResourceStatus;
  page: PagedState<StoreDoc>;
  reload: () => void;
  deleteDoc: (collection: string, recordID: string) => Promise<void>;
  clear: () => Promise<void>;
}

// useMicrositeStore —— one page of the page's documents at a time (docs/design/paging.md), in this
// component's own store (each page's panel lists its own store).
export function useMicrositeStore(slug: string): MicrositeStoreHook {
  const [store] = useState<PagedStore<StoreDoc>>(() => createPagedStore({
    name: 'microsite-store', path: `/microsites/${slug}/store`, item: StoreDocSchema,
  }));
  const page = usePaged(store);
  const { reload: reloadPage } = page;
  const reload = useCallback(() => { void reloadPage(); }, [reloadPage]);
  const deleteDoc = useCallback(
    (collection: string, recordID: string) =>
      adminAPI.deleteVoid(`/microsites/${slug}/store/${collection}/${recordID}`),
    [slug],
  );
  const clear = useCallback(() => adminAPI.deleteVoid(`/microsites/${slug}/store`), [slug]);
  return { docs: page.items, status: page.status, page, reload, deleteDoc, clear };
}
