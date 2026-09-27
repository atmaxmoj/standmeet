// code-filter —— the access-codes list's status chips. Codes pile up (self-test codes, one per
// application…), so the list opens on the active ones; revoked and expired stay one click away.
//
// Filtering, search and the counts run on the server (docs/design/paging.md): "expired" is
// derived there from expires_at, and a filter applied to loaded pages only would miss page 2.

export type CodeFilter = 'active' | 'revoked' | 'expired' | 'all';
export const CODE_FILTERS: readonly CodeFilter[] = ['active', 'revoked', 'expired', 'all'];

// asCodeFilter —— the page store keeps params as strings; anything unknown reads as 'all'.
export function asCodeFilter(s: string | undefined): CodeFilter {
  return CODE_FILTERS.find((f) => f === s) ?? 'all';
}
