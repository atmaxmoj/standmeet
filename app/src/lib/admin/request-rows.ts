// request-rows —— which access requests the list shows, and whether it must keep polling.
//
// Rows are filtered by status, but a row the owner is looking at does not vanish when its status
// changes under them: an approved request turns `replied` only once its mail went out, seconds
// later, and a card that disappears the moment it says "sent" is a card the owner never sees say
// it. So a row that matched the filter stays until the owner picks a filter again.

export type RequestStatusFilter = 'all' | 'open' | 'replied' | 'closed';

interface Row { id: string; status: string; mail?: { state: string } | undefined }

/** The rows to show: those matching the filter, plus those already on screen (`held`). */
export function visibleRows<T extends Row>(
  rows: readonly T[], filter: RequestStatusFilter, held: readonly string[],
): readonly T[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => r.status === filter || held.includes(r.id));
}

/** Whether two id lists are the same list. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether any mail is still on its way — then the list re-reads until none is. */
export function mailInFlight(rows: readonly Row[]): boolean {
  return rows.some((r) => r.mail?.state === 'sending');
}
