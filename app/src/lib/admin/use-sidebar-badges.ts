// use-sidebar-badges —— the dynamic badge counts AdminShell passes down to AdminSidebar.
//
// **The raw count is not fetched here.** It says the same thing as
// /admin/raw's header, its four tabs, and the pulse bar, so it reads from
// the same growth store — one datum, one source. It used to fetch on its
// own here, on a 60s poll: the owner deletes a row, the list loses a row,
// and this badge takes up to a minute to catch up — during which the two
// numbers on screen contradict each other (F-L-16). requests still fetches
// on its own (it has no shared store).

import { useEffect, useState } from 'react';

import { ACCESS_REQUEST_OPEN } from '@/lib/admin/access-request-status';
import { fetchListTotal } from '@/lib/api/list-total';
import { useListingsCount } from '@/lib/admin/use-admin-listings';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import type { SidebarBadges } from '@/components/admin/AdminSidebar';

export function useSidebarBadges(): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>({});
  // raw reads from the shared growth store (per F-L-4: it must be a real
  // COUNT(*), not the row count of the first page), so it moves in step with
  // the header, the tabs, and the pulse bar after every corpus mutation.
  const { growth } = useCorpusGrowth();
  // listings reads from the **same** listings store — the one behind
  // `/admin/listings`'s header and dashboard's `IN POOL` count. The badge
  // slot was declared in all three of NAV_GROUPS / SidebarBadges / BADGE_MAP,
  // yet nothing ever produced this number: 1148 real listings in the pool, and the sidebar stayed silent (F-N-4).
  const listings = useListingsCount();
  useEffect(() => {
    let cancel = false;
    const run = () => void fetchRequestBadge().then((b) => { cancel || setBadges(b); });
    run();
    const id = setInterval(run, 60_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);
  return {
    ...badges,
    raw: growth?.by_tier.raw_unprocessed,
    // Reports no number until fetched — printing 0 asserts "the pool is
    // empty", a claim that might not hold (same rule as dashboard's `poolCountLabel`).
    listings: listings.loading || listings.error !== null ? undefined : listings.rows.length,
  };
}

// fetchRequestBadge —— the open requests, counted on the server (the list is paged). A failed
// read shows no badge rather than a 0 that claims "nothing waiting".
async function fetchRequestBadge(): Promise<SidebarBadges> {
  const requests = await fetchListTotal(`/api/admin/access-requests?status=${ACCESS_REQUEST_OPEN}`)
    .catch(() => undefined);
  return { requests };
}
