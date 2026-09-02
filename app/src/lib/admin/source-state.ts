// source-state.ts —— derives the sentence shown on the right of every
// /admin/sources row from the data.
//
// What this page needs to answer is "is this source of mine still alive",
// so there are **three** states, not two:
//   · never tried       → `never fetched`
//   · tried, failed      → `last try · <date> · failed — <reason>`
//   · tried, succeeded    → `last · <date>`
//
// It used to have only `last_fetched_at` as a source, so a source that
// **was fetched but always failed** printed `never fetched` — indistinguishable
// from a source that was never touched (F-E-18: in the real environment all
// three rows looked like that, and the failure detail only ever lived in the
// receipt of the owner's one MCP call, gone the moment the window closed).
//
// The derivation lives here, not in the component: the presentation layer doesn't write if.

import type { AdminSourceRow } from '@/lib/admin/use-admin-sources';

export function sourceFailed(row: AdminSourceRow): boolean {
  return (row.last_error ?? '') !== '';
}

export function sourceStateLine(row: AdminSourceRow): string {
  return sourceFailed(row)
    ? `last try · ${dayOf(row.last_attempted_at)} · failed — ${row.last_error ?? ''}`
    : lastFetched(row.last_fetched_at);
}

function lastFetched(iso: string | null | undefined): string {
  return iso ? `last · ${iso.slice(0, 10)}` : 'never fetched';
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}
