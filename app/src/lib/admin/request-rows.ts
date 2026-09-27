// request-rows —— the access-requests list's filter vocabulary, and whether it must keep polling.
//
// Rows are filtered by status on the server (docs/design/paging.md). A row the owner is looking at
// does not vanish when its status changes under them: an approved request turns `replied` only once
// its mail went out, seconds later, and a card that disappears the moment it says "sent" is a card
// the owner never sees say it. The list is re-queried only when the owner picks a filter; an edit
// or a mail landing updates the row in place.

export type RequestStatusFilter = 'all' | 'open' | 'replied' | 'closed';

interface Row { id: string; mail?: { state: string } | undefined }

/** The server's status param for a filter ('' = every status). */
export function statusParam(filter: RequestStatusFilter): string {
  return filter === 'all' ? '' : filter;
}

/** The filter a status param stands for. */
export function filterOf(param: string | undefined): RequestStatusFilter {
  return param === 'open' || param === 'replied' || param === 'closed' ? param : 'all';
}

/** The rows whose mail is still on its way — the list re-reads them until none is. */
export function mailInFlight<T extends Row>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.mail?.state === 'sending');
}
