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

/** The status of a request still waiting on the owner. The badge and the dashboard KPI both
 * count it on the server (`?status=open`, the list's total). */
export const ACCESS_REQUEST_OPEN = 'open';
