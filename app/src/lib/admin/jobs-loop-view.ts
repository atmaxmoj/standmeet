// jobs-loop-view —— the value for the "JOBS · ACTIVE LOOP" cell on the dashboard.
//
// That cell used to not look at state at all: `JobsTopMatch()` took no
// parameters, read no state, had no branches, and always rendered "register
// sources to start matching"; the `0` under SHORTLIST next to it was a JSX
// literal (F-E-2). So when the owner already had sources registered and jobs
// sitting in the pool, they'd still read "go register a source" — told to do
// something already done, while the step actually missing (fetch) was never mentioned once.
//
// The right message already existed elsewhere in the product: /admin/listings,
// in the same state, says "sources are set up, go fetch" and even names the
// command to run. So this wasn't missing copy, it was missing **a place that
// looks at state**. This file is that place.
//
// Vocabulary was also brought in line: the pool column is called "in pool"
// on /admin/listings, so it isn't called "shortlist" here either (there's no
// such thing as a shortlist in this product); and ranking is Claude's job,
// StandMeet is only a state holder, so this reports **the latest entry in
// the pool**, not a "top match" it has no way to compute.

import type { AdminListingRow } from '@/lib/admin/use-admin-listings';

// PoolHeadState —— what the pool column says right now.
// loading and error must stay separate from "0": "the pool is empty" is a
// factual claim, and when the fetch failed, the fact is that it's unknown.
export type PoolHeadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'noSources' }
  | { kind: 'noFetch' }
  | { kind: 'job'; title: string; company: string; where: string };

export interface JobsLoopInput {
  sourceCount: number;
  listings: readonly AdminListingRow[];
  loading: boolean;
  error: string | null;
}

export function poolHeadState(in_: JobsLoopInput): PoolHeadState {
  if (in_.loading) return { kind: 'loading' };
  if (in_.error !== null) return { kind: 'error' };
  if (in_.sourceCount === 0) return { kind: 'noSources' };
  const top = in_.listings[0];
  if (top === undefined) return { kind: 'noFetch' };
  return { kind: 'job', title: top.title, company: top.company, where: top.location };
}

// headline / hint —— only the job branch has real data to assemble; the copy
// for the other branches is looked up by kind in the component, because it
// goes through i18n, and the lib layer doesn't touch next-intl.
export function jobHeadline(state: PoolHeadState): string {
  return state.kind === 'job' ? `${state.title} · ${state.company}` : '';
}

export function jobHint(state: PoolHeadState): string {
  return state.kind === 'job' ? state.where : '';
}

// poolCountLabel —— how many entries are in the pool. loading/error each get
// their own literal: '…' still fetching, '—' failed to fetch.
// Using '0' as a placeholder would assert "the pool is empty", a claim that might not hold.
export function poolCountLabel(in_: JobsLoopInput): string {
  return in_.loading ? '…' : in_.error !== null ? '—' : String(in_.listings.length);
}
