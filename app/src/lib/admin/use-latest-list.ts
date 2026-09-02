// use-latest-list —— GETs a `{ connectors: T[] }` endpoint into a list, with
// **latest-wins** + loaded. use-connector-list (owner-created) and
// use-connector-catalog (built-in catalog) share this one fetch logic instead
// of each writing their own (dim-3 single source).
// Latest-wins (dim-7): refresh is often fired back-to-back by create/remove —
// a later request can go out while an earlier one is still in flight, and
// out-of-order responses would let the old list clobber the new one. Only the
// most recently sent response is honored (the frontend mirror of the
// connector Hub race).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';

import { adminAPI } from '@/lib/api/admin';

interface LatestList<T> {
  items: readonly T[];
  loaded: boolean;
  loadError: boolean;
  refresh: () => void;
}

export function useLatestList<T>(
  path: string, schema: ZodType<{ connectors?: T[] | null }>,
): LatestList<T> {
  const [items, setItems] = useState<readonly T[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A load failure must not silently become an empty list: the owner needs to
  // tell "empty" apart from "failed to fetch" (a fetch failure is not an
  // expected business state — guide §2 forbids silencing it).
  const [loadError, setLoadError] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++seq.current;
    void adminAPI.get(path, schema)
      .then((r) => {
        if (mine !== seq.current) { return; }
        setItems(r.connectors ?? []); setLoaded(true); setLoadError(false);
      })
      .catch(() => { if (mine === seq.current) { setLoaded(true); setLoadError(true); } });
  }, [path, schema]);

  useEffect(() => { refresh(); }, [refresh]);
  return { items, loaded, loadError, refresh };
}
