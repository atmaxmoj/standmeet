// dashboard-view —— the dashboard's **presentation-layer data**: turns stats
// that "might not have loaded yet" into values a screen can render directly.
//
// Why this must live in lib and not in the component (F-L-52):
// That screen used to say `↑ 0 total`, `at zero`, `0 entries · total`,
// `nothing new in 14d`, and, worst of all, "Nothing pending — corpus is
// current." — all on the same frame as `loading…`. The big numbers honestly
// printed `—`, while **every sentence grown from those numbers** was
// asserting zero.
//
// The fix isn't sprinkling `loading &&` throughout the component (that's
// still discipline, not a structural fix). This file does one thing:
// **when there's no number, it doesn't even generate the "sentence"** — the
// component just gets `undefined`, and has nothing to render. The
// presentation layer holds to cyclo ≤ 3 + bans if, so branching can only
// live here; this is also the pattern already used elsewhere in the product
// (`use-corpus-growth`'s `pulseView`, `jobs-loop-view`).

import type { ActionItem, DashboardStats } from '@/lib/admin/use-admin-dashboard';
import { allActionItems } from '@/lib/admin/use-admin-dashboard';

// DASH —— the mark for "not known yet". Uses the same character as the four
// big numbers: a dash asserts nothing, while every sentence on this screen would be taken by the owner as a conclusion.
const DASH = '—';

export interface KpiCard {
  key: string;
  label: string;
  // value —— already-formed text (a number or `—`). The component does no formatting, so it can't miss the null branch.
  value: string;
  // trend / sub —— **absent** when there's no data (not an empty string): both lines of small print in this cell are derived from the number.
  trend?: string;
  sub?: string;
}

export function kpiCards(s: DashboardStats | null): KpiCard[] {
  return [
    kpiCard('entries', s?.rawCount, entriesTrend(s), 'raw + wiki + output'),
    kpiCard('unprocessed', s?.rawUnprocessed, unprocessedTrend(s), 'needs review'),
    kpiCard('codes live', s?.codesLive, codesTrend(s)),
    kpiCard('requests', s?.requestsNew, requestsTrend(s), 'from gate'),
  ];
}

function kpiCard(label: string, value: number | undefined, trend?: string, sub?: string): KpiCard {
  const known = value !== undefined;
  return {
    key: label,
    label,
    value: known ? value.toLocaleString() : DASH,
    trend: known ? trend : undefined,
    sub: known ? sub : undefined,
  };
}

function entriesTrend(s: DashboardStats | null): string | undefined {
  return s ? `↑ ${s.rawCount} total` : undefined;
}

function unprocessedTrend(s: DashboardStats | null): string | undefined {
  return s ? growingOrFlowing(s.rawUnprocessed) : undefined;
}

function growingOrFlowing(n: number): string {
  return n > 5 ? '↑ growing' : '↓ in flow';
}

function codesTrend(s: DashboardStats | null): string | undefined {
  return s ? `${s.codesLive} active` : undefined;
}

function requestsTrend(s: DashboardStats | null): string | undefined {
  return s ? newOrZero(s.requestsNew) : undefined;
}

function newOrZero(n: number): string {
  return n > 0 ? `↑ ${n} new` : 'at zero';
}

// PulseView —— the pulse card's screen. `verdict` undefined = right now it can't answer "has anything happened in these 14 days".
export interface PulseView {
  total: string;
  series: readonly number[];
  days: readonly string[];
  verdict: { active: boolean; added: number } | undefined;
}

export function pulseView(s: DashboardStats | null): PulseView {
  return {
    total: s ? s.rawCount.toLocaleString() : DASH,
    series: s?.pulse ?? [],
    days: s?.pulseDays ?? [],
    verdict: s ? { active: sum(s.pulse) > 0, added: sum(s.pulse) } : undefined,
  };
}

function sum(xs: readonly number[]): number {
  return xs.reduce((n, v) => n + v, 0);
}

// needsItems —— the "needs your hand" cell. **undefined and an empty array
// are not the same thing**: an empty array says "everything's been
// reviewed, nothing to do", undefined says "not known yet".
// The owner can call it done on the former, not on the latter.
export function needsItems(s: DashboardStats | null): ActionItem[] | undefined {
  return s ? allActionItems(s).filter((i) => i.count > 0) : undefined;
}
