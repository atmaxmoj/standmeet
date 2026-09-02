// use-recent-conversations —— data layer for the dashboard's "recent visitors" tile.
//
// **Three outcomes, each with its own shape**: `undefined` not fetched yet ·
// `null` fetch failed · array fetched (possibly empty).
//
// The initial value used to be `[]`, i.e. "fetched, zero visitors" — so the
// loading frame would read "no conversations yet — visitors will appear
// here once they start chatting" (F-L-52). The component already handled
// null and empty separately, but **the initial value silently folded the
// third case into "empty"**.
//
// Moved out of the component file into here: this is data-fetching, not
// presentation (the presentation layer holds to cyclo ≤ 3 + bans if —
// branches and effects don't belong there).

'use client';

import { useEffect, useState } from 'react';

import { fetchRecentConversations, type DashboardRecentRow } from '@/lib/admin/dashboard-fetch';

export type RecentRows = DashboardRecentRow[] | null | undefined;

export function useRecentConversations(): { rows: RecentRows } {
  const [rows, setRows] = useState<RecentRows>(undefined);
  useEffect(() => {
    void fetchRecentConversations('/api/admin/conversations/', 5)
      .then(setRows)
      .catch(() => setRows(null));
  }, []);
  return { rows };
}
