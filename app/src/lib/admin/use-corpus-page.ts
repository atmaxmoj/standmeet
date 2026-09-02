// use-corpus-page —— the admin grid's keyset pagination. Fetches one page at a time from
// GET /corpus/{genre}/page?cursor=, accumulating items; a mutation (corpus epoch bump)
// resets to the first page. Never loads the whole corpus — the grid windows what's loaded
// and asks for more as you scroll. Logic (branching, refs) lives in lib, not the grid.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useCorpusEpoch } from '@/lib/admin/corpus-tree-epoch';

export interface CorpusPage<T> {
  items: T[];
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
}

export function useCorpusPage<T>(pagePath: string, itemSchema: z.ZodType<T>): CorpusPage<T> {
  const epoch = useCorpusEpoch();
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const respSchema = useMemo(
    () => z.object({ items: z.array(itemSchema), next_cursor: z.string().optional() }),
    [itemSchema],
  );

  const fetchPage = useCallback(async (reset: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    const cur = reset ? undefined : cursorRef.current;
    // pagePath may already carry its own query (e.g. `?tag=math`), so the separator
    // must check whether it already has a `?` — hardcoding `?cursor=` would clobber
    // the tag, which is just another way for "filtered" to silently decay into
    // "filtered on one page" (F-L-23).
    const sep = pagePath.includes('?') ? '&' : '?';
    const qs = cur ? `${sep}cursor=${encodeURIComponent(cur)}` : '';
    try {
      const resp = await adminAPI.get(`${pagePath}${qs}`, respSchema);
      cursorRef.current = resp.next_cursor;
      setHasMore(Boolean(resp.next_cursor));
      setItems((prev) => (reset ? resp.items : [...prev, ...resp.items]));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, [pagePath, respSchema]);

  // (re)load the first page on mount + whenever the corpus mutates (epoch bump).
  useEffect(() => {
    cursorRef.current = undefined;
    void fetchPage(true);
  }, [fetchPage, epoch]);

  const loadMore = useCallback(() => {
    if (!busyRef.current && hasMore) void fetchPage(false);
  }, [fetchPage, hasMore]);

  return { items, hasMore, loading, loadMore };
}

// loadMoreIfNearEnd —— pull the next page when the last visible virtual row is within two
// rows of the end. Kept in lib so the grid component stays branch-free.
export function loadMoreIfNearEnd(
  lastIndex: number | undefined, rowCount: number, hasMore: boolean, loadMore: () => void,
): void {
  if (lastIndex !== undefined && lastIndex >= rowCount - 2 && hasMore) loadMore();
}
