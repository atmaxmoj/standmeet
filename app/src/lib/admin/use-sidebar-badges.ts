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

import { z } from 'zod';

import { pendingRequests } from '@/lib/admin/access-request-status';
import { safeJson } from '@/lib/api/typed-json';
import { useListingsCount } from '@/lib/admin/use-admin-listings';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import type { SidebarBadges } from '@/components/admin/AdminSidebar';

// The list endpoints return a BARE array of rows, not `{items:[…]}`. Parsing a
// bare array as an object throws a ZodError (invalid_type object) on every admin
// load — the old `{items}` shape was wrong. Fixed to a bare-array schema.
const BadgeRowsSchema = z.array(z.object({ status: z.string().optional() }));

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

async function fetchRequestBadge(): Promise<SidebarBadges> {
  const out: SidebarBadges = {};
  const res = await fetch('/api/admin/access-requests', { credentials: 'include' })
    .catch(() => null);
  if (res !== null && res.ok) {
    const rows = await safeJson(res, BadgeRowsSchema);
    out.requests = pendingRequests(rows).length;
  }
  return out;
}
