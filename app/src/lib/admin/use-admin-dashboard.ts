// use-admin-dashboard —— fans out fetches across 4 existing admin list
// endpoints, returning KPI counts. A lightweight approach (vs. a single
// aggregator endpoint): each list has < a few hundred rows, so the browser
// firing 4 parallel fetches + counting is good enough for a single refresh.
//
// Once list sizes grow, consider adding `/api/admin/dashboard/stats` as a separate SUM query.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { pendingRequests } from '@/lib/admin/access-request-status';
import { growthStore } from '@/lib/admin/use-corpus-growth';

export interface DashboardStats {
  rawCount: number;
  rawUnprocessed: number;
  codesLive: number;
  requestsNew: number;
  conversationsCount: number;
  draftsReviewing: number;
  // pulse —— corpus additions per day (UTC) over the last 14 days, from
  // /stats/growth's real series (rot-A1: this used to render the hardcoded
  // MOCK_14D, while the real data had been sitting in the same endpoint all along, dropped by the schema).
  pulse: readonly number[];
  // pulseDays —— the dates aligned with pulse (each point's x label), so the
  // sparkline's hover tooltip can show "date · value" — letting the owner
  // read exactly how many on which day (F-C-5: a chart you can't read numbers off of is just a shape).
  pulseDays: readonly string[];
  // aiProviderUsable —— can this instance still answer a visitor (at least
  // one entry in the registry has a key configured).
  // When it can't, visitors get a 503, and the owner side used to have **no
  // indication at all** — the form sat empty, looking like "never configured
  // yet", so visitor after visitor got turned away without him knowing (F-A-24). This is the data source for that indicator.
  aiProviderUsable: boolean;
}

// State.stats —— **null = not fetched yet**, not "fetched, and it's all
// zeros" (F-L-52).
//
// A fully-zero `EMPTY_STATS` used to sit here as the initial value, so the
// same screen once showed things like: the header saying `dashboard ·
// loading…`, the four big numbers honestly printing `—`, and every sentence
// grown from those numbers asserting zero — `↑ 0 total`, `at zero`, `0
// entries · total`, `nothing new in 14d`, and worst of all "Nothing pending
// — corpus is current." Meanwhile the sidebar rail said `+2 in 7d` at the
// same time. The numbers knew they were loading; the sentences grown from
// them didn't ([[lesson-not-swept-to-neighbours]]).
//
// The fix isn't sprinkling another `loading &&` everywhere — that's still
// discipline, not a structural fix. It's making it **impossible to compute**:
// no number means no object, and every reader has to face null first.
interface State {
  stats: DashboardStats | null;
  loading: boolean;
  error: string | null;
}

// Counts come from the real COUNT(*) growth endpoint, NOT a paginated list length (F-L-4):
// /api/admin/corpus/raw caps at defaultCorpusLimit=50, so `raw.length` under-counts past one page.
const GrowthSchema = z.object({
  by_tier: z.object({
    raw: z.number(), wiki: z.number(), output: z.number(),
    raw_unprocessed: z.number().optional().default(0),
  }),
  // series —— additions per day over the last 14 days (date_trunc GROUP BY).
  // This wasn't declared in the schema before, so the real data was dropped,
  // and the dashboard fell back to rendering MOCK_14D (rot-A1). It's now parsed and fed into corpus-pulse.
  series: z.array(z.object({ day: z.string(), count: z.number() })).optional().default([]),
});
const CodeRowSchema = z.object({ id: z.string(), status: z.string() });
const RequestRowSchema = z.object({ id: z.string(), status: z.string() });
const ConvRowSchema = z.object({ id: z.string() });
const DraftRowSchema = z.object({ id: z.string(), status: z.string().optional() });
// key_configured is the only credential for "can this entry actually be called" — a provider row with no key can't answer a visitor.
const ProviderRowSchema = z.object({ id: z.string(), key_configured: z.boolean() });

export function useAdminDashboard(): State {
  const [state, setState] = useState<State>({
    stats: null, loading: true, error: null,
  });
  useEffect(() => { void load(setState); }, []);
  return state;
}

export interface ActionItem {
  key: string;
  count: number;
  label: string;
  sub: string;
  href: string;
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function allActionItems(stats: DashboardStats): ActionItem[] {
  return [
    // Listed first, because on its own it can make the whole instance unable
    // to answer anyone: a visitor's very first message gets a 503.
    // This row exists to **break the silence** — in F-A-24 the only way the owner could notice was to go be a visitor themself.
    { key: 'ai', count: stats.aiProviderUsable ? 0 : 1,
      label: 'no usable AI provider',
      sub: 'visitors are being turned away — set a key under api · mcp',
      href: '/admin/api-mcp' },
    { key: 'requests', count: stats.requestsNew,
      label: `${stats.requestsNew} access ${pluralize(stats.requestsNew, 'request', 'requests')}`,
      sub: 'visitors waiting on a code', href: '/admin/requests' },
    // F-C-6: the original copy "promote, edit, or archive" was a lie — raw
    // has no archive feature; and it framed raw as a to-do queue. raw is a
    // fermentation pool: leaving something untouched is a valid state, and the copy should say so.
    { key: 'raw', count: stats.rawUnprocessed,
      label: `${stats.rawUnprocessed} raw ${pluralize(stats.rawUnprocessed, 'entry', 'entries')} unprocessed`,
      sub: 'promote, edit, or let them ferment', href: '/admin/raw' },
    { key: 'drafts', count: stats.draftsReviewing ?? 0,
      label: 'resume drafts pending',
      sub: 'AI generated · awaiting your review', href: '/admin/drafts' },
  ];
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const [growth, codes, requests, conversations, drafts, providers] = await Promise.all([
      fetchGrowth(),
      fetchList('/api/admin/codes/', z.array(CodeRowSchema)),
      fetchList('/api/admin/access-requests', z.array(RequestRowSchema)),
      fetchList('/api/admin/conversations', z.array(ConvRowSchema)),
      fetchList('/api/admin/drafts/', z.array(DraftRowSchema)),
      fetchList('/api/admin/providers/', z.array(ProviderRowSchema)),
    ]);
    setState({
      stats: {
        rawCount: growth.by_tier.raw + growth.by_tier.wiki + growth.by_tier.output,
        rawUnprocessed: growth.by_tier.raw_unprocessed,
        codesLive: codes.filter((c) => c.status === 'active').length,
        requestsNew: pendingRequests(requests).length,
        conversationsCount: conversations.length,
        draftsReviewing: drafts.filter((d) => d.status !== 'sent').length,
        pulse: growth.series.map((d) => d.count),
        pulseDays: growth.series.map((d) => d.day),
        aiProviderUsable: providers.some((p) => p.key_configured),
      },
      loading: false, error: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load dashboard failed';
    // Failure is also null: **"failed to fetch" and "fetched, and it's
    // empty" must never look the same** — that's exactly what the
    // `admin-load-failure-not-empty` family next to this file guards. The error is displayed separately.
    setState({ stats: null, loading: false, error: msg });
  }
}

const WrappedListSchema = z.object({ items: z.array(z.unknown()).optional() });

// fetchGrowth —— goes through the **shared** growth store, no longer fetches its own copy (F-C-31).
//
// The sidebar rail and this pulse card draw from the same count. Fetching
// separately meant the two requests landed at two different moments, and one
// corpus entry landing in between was enough: the rail said `+2 in 7d` while
// the card simultaneously said `nothing new in 14d` — and since 7 days is a
// subset of 14 days, both statements can't be true at once. `refresh()`
// rather than `ensureLoaded()`: entering dashboard means wanting the latest
// number, and a cached stale value is exactly the other half of this contradiction.
async function fetchGrowth(): Promise<z.infer<typeof GrowthSchema>> {
  await growthStore.getState().refresh();
  const data = growthStore.getState().data;
  if (!data) throw new Error('corpus growth is not loaded');
  return GrowthSchema.parse(data);
}

async function fetchList<T>(url: string, schema: z.ZodType<T[]>): Promise<T[]> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const raw: unknown = await res.json();
  const items = Array.isArray(raw) ? raw : (WrappedListSchema.safeParse(raw).success ? WrappedListSchema.parse(raw).items ?? [] : []);
  return schema.parse(items);
}
