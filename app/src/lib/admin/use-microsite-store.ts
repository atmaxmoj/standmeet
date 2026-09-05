// use-microsite-store —— the owner's management view of one microsite's data store (the
// per-page NoSQL namespace visitors write into). Backed by the admin store routes:
//   GET    /api/admin/microsites/{slug}/store                          → list docs
//   DELETE /api/admin/microsites/{slug}/store/{collection}/{record_id} → delete one
//   DELETE /api/admin/microsites/{slug}/store                          → clear the store

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import type { ResourceStatus } from '@/lib/state/status';

const StoreDocSchema = z.object({
  id: z.string(),
  collection: z.string(),
  // doc is opaque JSON the page defined — keep it as-is for display.
  doc: z.unknown(),
});
export type StoreDoc = z.infer<typeof StoreDocSchema>;

const StoreDocsSchema = z.object({
  slug: z.string(),
  docs: z.array(StoreDocSchema),
});

interface State {
  docs: StoreDoc[];
  status: ResourceStatus;
}

export function useMicrositeStore(slug: string): State & {
  reload: () => void;
  deleteDoc: (collection: string, recordID: string) => Promise<void>;
  clear: () => Promise<void>;
} {
  const [state, setState] = useState<State>({ docs: [], status: 'loading' });
  const reload = useCallback(() => { void load(slug, setState); }, [slug]);
  useEffect(() => { reload(); }, [reload]);
  const deleteDoc = useCallback(
    (collection: string, recordID: string) =>
      adminAPI.deleteVoid(`/microsites/${slug}/store/${collection}/${recordID}`),
    [slug],
  );
  const clear = useCallback(() => adminAPI.deleteVoid(`/microsites/${slug}/store`), [slug]);
  return { ...state, reload, deleteDoc, clear };
}

async function load(slug: string, setState: (s: State) => void): Promise<void> {
  try {
    const res = await adminAPI.get(`/microsites/${slug}/store`, StoreDocsSchema);
    setState({ docs: res.docs, status: 'ready' });
  } catch {
    setState({ docs: [], status: 'error' });
  }
}
