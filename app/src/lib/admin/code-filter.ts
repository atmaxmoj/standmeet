// code-filter —— the access-codes list's status filter and search. Codes pile up (self-test codes,
// one per application…), so the list opens on the active ones; revoked and expired stay one click
// away, each with its count.
//
// "Expired" is not stored: it is a code that is not revoked and whose expires_at has passed. It is
// derived here from that one field, so it can never disagree with it.

'use client';

import { useState } from 'react';

import type { CodeView } from '@/lib/admin/use-codes';

export type CodeFilter = 'active' | 'revoked' | 'expired' | 'all';
export const CODE_FILTERS: readonly CodeFilter[] = ['active', 'revoked', 'expired', 'all'];

type CodeState = Exclude<CodeFilter, 'all'>;

export function codeState(c: CodeView, now: number): CodeState {
  if (c.status === 'revoked') return 'revoked';
  const expires = c.expires_at === undefined ? NaN : Date.parse(c.expires_at);
  return expires <= now ? 'expired' : 'active';
}

function matchesQuery(c: CodeView, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
}

/** The codes the list shows: in the chosen filter and matching the search. */
export function visibleCodes(
  codes: readonly CodeView[], filter: CodeFilter, query: string, now: number,
): CodeView[] {
  return codes.filter((c) => (filter === 'all' || codeState(c, now) === filter) && matchesQuery(c, query));
}

/** How many codes each filter holds (before the search). */
export function filterCounts(codes: readonly CodeView[], now: number): Record<CodeFilter, number> {
  const counts: Record<CodeFilter, number> = { active: 0, revoked: 0, expired: 0, all: codes.length };
  for (const c of codes) counts[codeState(c, now)] += 1;
  return counts;
}

export interface CodeFilterHook {
  filter: CodeFilter;
  setFilter: (f: CodeFilter) => void;
  query: string;
  setQuery: (q: string) => void;
}

export function useCodeFilter(): CodeFilterHook {
  const [filter, setFilter] = useState<CodeFilter>('active');
  const [query, setQuery] = useState('');
  return { filter, setFilter, query, setQuery };
}
