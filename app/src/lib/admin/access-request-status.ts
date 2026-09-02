// access-request-status —— the **single** criterion for "is this access
// request still waiting on the owner".
//
// This vocabulary used to be written once in each of two files, and
// differently: the sidebar badge counted `'open'` (correct), dashboard's
// REQUESTS count counted `'new' || 'pending'` (two values the backend never
// produces). So on the same data, the badge showed 1 while the KPI showed
// 0 — and that 0 stayed 0 no matter how many were actually pending (F-C-19).
//
// The backend's vocabulary is hardcoded in `access_request.go`:
// `'open' | 'replied' | 'closed'`. This file recognizes only that. Collecting
// it into one place isn't about typing less — it's so that **next time the
// vocabulary changes, there's only one place that can be missed**.

/** The values of the backend's access_requests.status column. */
export const ACCESS_REQUEST_OPEN = 'open';

/** Requests still waiting on the owner (both the badge and the KPI count this set).
 *
 * status is accepted as optional: the schema on the badge side allows this
 * field to be missing. Missing **doesn't count** as pending — a row whose
 * status can't be read is better undercounted than sending the owner
 * chasing a request that doesn't exist. */
export function pendingRequests<T extends { status?: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.status === ACCESS_REQUEST_OPEN);
}
