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

// SourceStateView —— the three states, as data. The copy is looked up by kind
// in the component (through next-intl); the lib layer doesn't touch next-intl.
// `date` is '' when the timestamp is absent — the component substitutes the
// "unknown" label there.
export type SourceStateView =
  | { kind: 'never' }
  | { kind: 'fetched'; date: string }
  | { kind: 'failed'; date: string; reason: string };

export function sourceStateView(row: AdminSourceRow): SourceStateView {
  return sourceFailed(row)
    ? { kind: 'failed', date: dayOf(row.last_attempted_at), reason: row.last_error ?? '' }
    : lastFetched(row.last_fetched_at);
}

// viewDate / viewReason —— narrow the union here so the presentation layer
// (which may not write `if`) can hand the pieces straight to next-intl. '' means
// "absent"; the component turns an absent date into the localized "unknown".
export function viewDate(view: SourceStateView): string {
  return view.kind === 'never' ? '' : view.date;
}

export function viewReason(view: SourceStateView): string {
  return view.kind === 'failed' ? view.reason : '';
}

function lastFetched(iso: string | null | undefined): SourceStateView {
  return iso ? { kind: 'fetched', date: iso.slice(0, 10) } : { kind: 'never' };
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}
