// use-admin-listings —— the /admin/listings pool (#50). Reads the FetchedJob
// entries currently sitting in the Redis 1d-TTL pool (not yet committed);
// admin is read-only here. Fetching goes through MCP jobs.fetch_new; this
// file only displays. The pool is ephemeral: expired, or fetch hasn't run in a while → empty state.
//
// **One datum, one source** (F-N-4): this pool has three readers —
// `/admin/listings`'s list, dashboard's `IN POOL`, and the sidebar's
// `listings` badge. They must all read the same store, or the screen ends up
// with contradictions like "header says 1148, badge is blank". The badge
// slot used to be declared in three places (`NAV_GROUPS`'s badgeTestId,
// `SidebarBadges.listings`, `BADGE_MAP`) with zero writers, so with 1148 real
// listings sitting in the pool, the sidebar stayed silent.

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

const AdminListingRowSchema = z.object({
  cache_id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  source_kind: z.string(),
  published_at: z.string(),
  tags: z.array(z.string()),
});
export type AdminListingRow = z.infer<typeof AdminListingRowSchema>;

const ListingsSchema = z.array(AdminListingRowSchema);

export const listingsStore = createResourceStore<AdminListingRow[]>({
  name: 'admin-listings',
  fetcher: () => adminAPI.get('/listings/', ListingsSchema),
});

interface State {
  rows: AdminListingRow[];
  loading: boolean;
  error: string | null;
}

// ListingsHook —— the listings view: the pool rows plus the ability to pull new jobs.
export interface ListingsHook extends State {
  fetching: boolean;
  fetchNow: () => Promise<void>;
}

// autoFetched —— fetch-on-open, once per session (module-scoped, not per-mount). The
// owner asked for **auto-fetch** — "why do I have to ask Claude to fetch?" — but a
// fetch reaches out to every registered job board, so doing it on *every* navigation to
// this section would hammer those boards. Once per session: the first time the owner
// opens listings we pull automatically; after that it's the manual "fetch now" button.
let autoFetched = false;

// fetchNow —— pull every registered source into the pool (POST), then re-read it (GET,
// the shared store both surfaces watch). The POST returns the pool too, but re-reading
// keeps the sidebar badge and the list same-sourced through the one store.
async function fetchNow(): Promise<void> {
  await adminAPI.post('/listings/fetch', {}, ListingsSchema);
  await listingsStore.getState().refresh();
}

// useAdminListings —— for **the two surfaces that view this pool**
// (/admin/listings and dashboard).
//
// Entering this section calls `refresh` rather than `ensureLoaded`: the pool
// is ephemeral data with a 1-day TTL, and it's written by MCP (the owner has
// it fetch a batch from inside Claude), so the product side never knows when
// it changes. Caching the first result would mean "fetched but invisible" —
// exactly the F-L-16 family of bugs (a count frozen from before the latest
// mutation). The shared store exists to keep the badge and the list
// **same-sourced**, not to send fewer requests.
export function useAdminListings(): ListingsHook {
  const r = useResource(listingsStore);
  const [fetching, setFetching] = useState(false);
  const runFetch = useCallback(async () => {
    setFetching(true);
    try {
      await fetchNow();
    } finally {
      setFetching(false);
    }
  }, []);
  // Always re-read the pool on open (fast GET — shows whatever is already there); and the
  // first open this session **also** pulls new jobs in the background (POST). Reading
  // first, then pulling, means the list never sits blank waiting on a fetch — the existing
  // pool shows immediately and new jobs slot in when they land.
  useEffect(() => {
    void listingsStore.getState().refresh();
    if (autoFetched) return;
    autoFetched = true;
    void runFetch();
  }, [runFetch]);
  return { ...listingsState(r.data, r.status, r.error), fetching, fetchNow: runFetch };
}

// useListingsCount —— the sidebar badge: only **reads** this store, never sends its own request.
// It's mounted on every admin page, so fetching again would fetch the same data twice.
export function useListingsCount(): State {
  const r = useResource(listingsStore);
  return listingsState(r.data, r.status, r.error);
}

function listingsState(
  data: AdminListingRow[] | undefined, status: string, error: string | null,
): State {
  return {
    rows: data ?? [],
    loading: status === 'idle' || status === 'loading',
    error: status === 'error' ? (error ?? '') : null,
  };
}

export type ListingsBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickListingsBodyState —— used by the component, avoids an if-ladder in the .tsx that would trip no-if/cyclo.
export function pickListingsBodyState(
  count: number, loading: boolean, error: string | null,
): ListingsBodyState {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}
