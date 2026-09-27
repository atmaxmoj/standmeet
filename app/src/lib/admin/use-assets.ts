// use-assets —— the global asset pool for Resources → Assets.
// GET /api/admin/assets lists it; DELETE /api/admin/assets/{id} removes one — the backend
// refuses (409, naming who references it) while any corpus entry or microsite still uses it,
// which surfaces to the owner as the delete's error toast.

import { useCallback, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import {
  createPagedStore, usePaged, type PagedState, type PagedStore,
} from '@/lib/state/create-paged-store';
import type { ResourceStatus } from '@/lib/state/status';

const PoolAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string(),
  size_bytes: z.number(),
});
export type PoolAsset = z.infer<typeof PoolAssetSchema>;

// The paged store keys rows by id; a pool asset's id is its asset_id.
const PagedAssetSchema = PoolAssetSchema.transform((a) => ({ ...a, id: a.asset_id }));

export interface AssetsHook {
  assets: readonly PoolAsset[];
  status: ResourceStatus;
  page: PagedState<PoolAsset & { id: string }>;
  query: string;
  setQuery: (q: string) => void;
  reload: () => void;
  remove: (id: string) => Promise<void>;
  upload: (file: File) => Promise<void>;
}

// useAssets —— one page of the pool at a time (docs/design/paging.md), in this component's own
// store: the Assets manager, the favicon picker (kind 'image') and the corpus attach picker each
// page and search on their own. kind filters on the server.
export function useAssets(kind: '' | 'image' = ''): AssetsHook {
  const [store] = useState<PagedStore<PoolAsset & { id: string }>>(() => createPagedStore({
    name: 'assets', path: '/assets', item: PagedAssetSchema, params: { kind, q: '' },
  }));
  const page = usePaged(store);
  const { reload: reloadPage } = page;
  const reload = useCallback(() => { void reloadPage(); }, [reloadPage]);
  const remove = useCallback((id: string) => adminAPI.deleteVoid(`/assets/${id}`), []);
  // Upload straight into the pool (no corpus entry): POST /assets, bytes as multipart. The
  // caller re-lists afterward, which is this control's receipt (the new card appears).
  const upload = useCallback((file: File) => {
    const form = new FormData();
    form.append('file', file);
    return adminAPI.postFormVoid('/assets', form);
  }, []);
  return {
    assets: page.items, status: page.status, page,
    query: page.params.q ?? '', setQuery: (q) => page.setParams({ q }),
    reload, remove, upload,
  };
}

// isImage —— show a thumbnail for images; everything else (PDF etc.) shows as a named file.
export function isImage(a: PoolAsset): boolean {
  return a.kind === 'image' || a.content_type.startsWith('image/');
}

// sizeLabel —— compact human size for the card footer.
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
