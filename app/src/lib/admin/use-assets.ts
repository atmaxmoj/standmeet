// use-assets —— the global asset pool for Resources → Assets.
// GET /api/admin/assets lists it; DELETE /api/admin/assets/{id} removes one — the backend
// refuses (409, naming who references it) while any corpus entry or microsite still uses it,
// which surfaces to the owner as the delete's error toast.

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
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

interface State {
  assets: PoolAsset[];
  status: ResourceStatus;
}

export function useAssets(): State & {
  reload: () => void;
  remove: (id: string) => Promise<void>;
  upload: (file: File) => Promise<void>;
} {
  const [state, setState] = useState<State>({ assets: [], status: 'loading' });
  const reload = useCallback(() => { void load(setState); }, []);
  useEffect(() => { reload(); }, [reload]);
  const remove = useCallback((id: string) => adminAPI.deleteVoid(`/assets/${id}`), []);
  // Upload straight into the pool (no corpus entry): POST /assets, bytes as multipart. The
  // caller re-lists afterward, which is this control's receipt (the new card appears).
  const upload = useCallback((file: File) => {
    const form = new FormData();
    form.append('file', file);
    return adminAPI.postFormVoid('/assets', form);
  }, []);
  return { ...state, reload, remove, upload };
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const assets = await adminAPI.get('/assets', z.array(PoolAssetSchema));
    setState({ assets, status: 'ready' });
  } catch {
    setState({ assets: [], status: 'error' });
  }
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
