// use-microsite-store —— the owner's management view of one microsite's data store (the
// per-page NoSQL namespace visitors write into). Backed by the admin store routes:
//   GET    /api/admin/microsites/{slug}/store                                  → one page of docs, newest first
//   DELETE /api/admin/microsites/{slug}/store/{collection}/{record_id}         → delete one
//   POST   /api/admin/microsites/{slug}/store/{collection}/{record_id}/approve → publish a waiting one
//   DELETE /api/admin/microsites/{slug}/store                                  → clear the store
//   GET/PUT /api/admin/microsites/{slug}/store-policy                          → its limit + review

import { useCallback, useEffect, useState } from 'react';

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

const StorePolicySchema = z.object({ max_docs: z.number(), review: z.boolean() });
export type StorePolicy = z.infer<typeof StorePolicySchema>;

export interface MicrositeStoreHook {
  docs: readonly StoreDoc[];
  status: ResourceStatus;
  page: PagedState<StoreDoc>;
  // policy —— null until read.
  policy: StorePolicy | null;
  reload: () => void;
  deleteDoc: (collection: string, recordID: string) => Promise<void>;
  approveDoc: (collection: string, recordID: string) => Promise<void>;
  setPolicy: (change: Partial<StorePolicy>) => Promise<void>;
  clear: () => Promise<void>;
}

const PendingDocSchema = z.object({ _status: z.literal('pending') });

// isPending —— a document that waits for the owner's review (host key `_status`).
export function isPending(d: StoreDoc): boolean {
  return PendingDocSchema.safeParse(d.doc).success;
}

// useMicrositeStore —— one page of the page's documents at a time (docs/design/paging.md), in this
// component's own store (each page's panel lists its own store), plus the store's policy.
export function useMicrositeStore(slug: string): MicrositeStoreHook {
  const [store] = useState<PagedStore<StoreDoc>>(() => createPagedStore({
    name: 'microsite-store', path: `/microsites/${slug}/store`, item: StoreDocSchema,
  }));
  const page = usePaged(store);
  const { reload: reloadPage } = page;
  const reload = useCallback(() => { void reloadPage(); }, [reloadPage]);
  const [policy, setPolicyState] = useState<StorePolicy | null>(null);
  useEffect(() => {
    void adminAPI.get(`/microsites/${slug}/store-policy`, StorePolicySchema).then(setPolicyState);
  }, [slug]);
  const deleteDoc = useCallback(
    (collection: string, recordID: string) =>
      adminAPI.deleteVoid(`/microsites/${slug}/store/${collection}/${recordID}`),
    [slug],
  );
  const approveDoc = useCallback(
    (collection: string, recordID: string) =>
      adminAPI.postVoid(`/microsites/${slug}/store/${collection}/${recordID}/approve`, {}),
    [slug],
  );
  const setPolicy = useCallback(async (change: Partial<StorePolicy>) => {
    setPolicyState(await adminAPI.put(`/microsites/${slug}/store-policy`, change, StorePolicySchema));
  }, [slug]);
  const clear = useCallback(() => adminAPI.deleteVoid(`/microsites/${slug}/store`), [slug]);
  return {
    docs: page.items, status: page.status, page, policy, reload, deleteDoc, approveDoc, setPolicy, clear,
  };
}
