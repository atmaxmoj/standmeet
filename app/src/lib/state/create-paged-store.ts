// create-paged-store —— the one client paginator every owner list uses (docs/design/paging.md).
//
// The server answers {items, next_cursor}; this store accumulates pages. Filters and search are
// `params`: changing them reloads from page 1, because a filter applied to loaded pages only
// would report "none match" while matches sit on page 2 (F-L-23).
//
//   export const codesPage = createPagedStore({ name: 'codes', path: '/codes/', item: CodeViewSchema,
//                                               params: { state: 'active', q: '' } });
//   const page = usePaged(codesPage);          // loads page 1 on mount
//   <LoadMore page={page} />                   // next page on scroll / click
//
// After a create or delete call reload(); after an in-place edit call patch(), so an edit on
// page 3 does not throw the owner back to page 1.

import { useEffect, type RefObject } from 'react';
import { z } from 'zod';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { APIError } from '@/lib/api/api-error';
import { logger } from '@/lib/logger';
import type { ResourceStatus } from '@/lib/state/status';

export type PageParams = Readonly<Record<string, string>>;

export interface PagedState<T> {
  status: ResourceStatus;
  items: readonly T[];
  // total —— how many rows match across every page, when the list reports it (null otherwise).
  // Never items.length: that is only what has been loaded.
  total: number | null;
  params: PageParams;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  errorStatus: number | null;
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
  setParams: (next: Partial<Record<string, string>>) => void;
  patch: (id: string, fn: (item: T) => T) => void;
}

// ItemSchema —— parses one wire row; may transform it into the view the list renders.
type ItemSchema = z.ZodType<{ id: string }, unknown>;

export interface PagedStoreOpts<S extends ItemSchema> {
  name: string;
  path: string;
  item: S;
  params?: PageParams;
}

export type PagedStore<T> = UseBoundStore<StoreApi<PagedState<T>>>;

interface Internal { cursor: string | undefined; gen: number }

export function createPagedStore<S extends ItemSchema>(
  opts: PagedStoreOpts<S>,
): PagedStore<z.output<S>> {
  type T = z.output<S>;
  const page = z.object({
    items: z.array(opts.item), next_cursor: z.string().optional(), total: z.number().optional(),
  });
  // gen —— a reload bumps it; a page that lands for an older gen is dropped, so a slow page 2
  // of the old filter never appends to the new filter's list.
  const inner: Internal = { cursor: undefined, gen: 0 };
  return create<PagedState<T>>((set, get) => {
    const fetchPage = async (reset: boolean): Promise<void> => {
      const gen = reset ? ++inner.gen : inner.gen;
      const cursor = reset ? undefined : inner.cursor;
      set(reset ? { status: 'loading', error: null, errorStatus: null } : { loadingMore: true });
      try {
        const resp = await adminAPI.get(pageURL(opts.path, get().params, cursor), page);
        if (gen !== inner.gen) return;
        inner.cursor = resp.next_cursor;
        set((s) => ({
          status: 'ready', loadingMore: false, hasMore: Boolean(resp.next_cursor),
          total: resp.total ?? null,
          items: reset ? resp.items : appendNew(s.items, resp.items),
        }));
      } catch (e) {
        if (gen !== inner.gen) return;
        logger.error(`paged ${opts.name}: fetch`, e);
        // A failed first page is 'error' (ListPane says "did not load", never "empty"); a failed
        // later page keeps what is shown and says so.
        set((s) => ({
          status: reset ? 'error' : s.status, loadingMore: false,
          error: e instanceof Error ? e.message : 'load failed',
          errorStatus: e instanceof APIError ? e.status : null,
        }));
      }
    };
    return {
      status: 'idle', items: [], total: null, params: opts.params ?? {}, hasMore: false, loadingMore: false,
      error: null, errorStatus: null,
      ensureLoaded: async () => { if (get().status === 'idle') await fetchPage(true); },
      reload: () => fetchPage(true),
      loadMore: async () => {
        const s = get();
        if (s.hasMore && !s.loadingMore && s.status === 'ready') await fetchPage(false);
      },
      setParams: (next) => {
        set((s) => ({ params: mergeParams(s.params, next) }));
        void fetchPage(true);
      },
      patch: (id, fn) => set((s) => ({ items: s.items.map((it) => (it.id === id ? fn(it) : it)) })),
    };
  });
}

// reloadIfLoaded —— re-read a list another list's write touched (a promote adds to the next
// genre), unless nobody has opened it yet: it loads fresh on first view anyway.
export async function reloadIfLoaded<T>(store: PagedStore<T>): Promise<void> {
  if (store.getState().status !== 'idle') await store.getState().reload();
}

// totalLabel —— a section header's count from the server's total; '' until it is known.
export function totalLabel(total: number | null, format: (n: number) => string): string {
  return total === null ? '' : format(total);
}

// appendNew —— a list ordered by activity (conversations by last message) can move a row
// between the fetch of page 1 and page 2; the row then comes back twice. Keep the first.
function appendNew<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(prev.map((it) => it.id));
  return [...prev, ...next.filter((it) => !seen.has(it.id))];
}

function mergeParams(prev: PageParams, next: Partial<Record<string, string>>): PageParams {
  const out: Record<string, string> = { ...prev };
  for (const [k, v] of Object.entries(next)) out[k] = v ?? '';
  return out;
}

// pageURL —— params and cursor as the query string; empty values are left out.
export function pageURL(path: string, params: PageParams, cursor: string | undefined): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '') q.set(k, v);
  if (cursor) q.set('cursor', cursor);
  const qs = q.toString();
  return qs === '' ? path : `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

// useLoadMoreOnView —— load the next page when `ref` scrolls into view (the LoadMore sentinel).
export function useLoadMoreOnView(
  ref: RefObject<HTMLElement | null>,
  page: { hasMore: boolean; loadingMore: boolean; loadMore: () => Promise<void> },
): void {
  const { hasMore, loadingMore, loadMore } = page;
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loadingMore) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    });
    io.observe(node);
    return () => io.disconnect();
  }, [ref, hasMore, loadingMore, loadMore]);
}

// usePaged —— read a paged store and load page 1 while it is idle. Depends on status, so a
// store put back to idle re-arms (the same lesson as useResource).
export function usePaged<T>(store: PagedStore<T>): PagedState<T> {
  const state = store();
  const { ensureLoaded, status } = state;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded, status]);
  return state;
}
