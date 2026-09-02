// use-corpus-growth —— data layer for Monitor/SystemPulse. GET
// /api/admin/stats/growth fetches the real corpus's 14-day daily series +
// 7-day delta + per-tier totals. Read-only, fetched once on mount.
// Branching/formatting all live here (lib), keeping the SystemPulse component free of if.

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';

const DayCountSchema = z.object({ day: z.string(), count: z.number() });
const CorpusGrowthSchema = z.object({
  total: z.number(),
  delta_7d: z.number(),
  by_tier: z.object({
    raw: z.number(), wiki: z.number(), output: z.number(),
    writing: z.number().optional().default(0),
    raw_unprocessed: z.number().optional().default(0),
  }),
  series: z.array(DayCountSchema),
});
export type CorpusGrowth = z.infer<typeof CorpusGrowthSchema>;

// growthStore —— **this count has exactly one home**. The sidebar pulse
// bar, /admin/raw's header and tabs, the sidebar badge, and dashboard's
// pulse card must all read from it (F-C-31).
//
// dashboard used to `fetch('/api/admin/stats/growth')` on its own, again:
// same endpoint, two requests, two moments in time. Let one corpus entry
// land in between and the same screen could show "the rail says +2 in 7d"
// alongside "the card says nothing new in 14d" — 7 days is a **subset** of 14 days, and both statements can't be true at once.
export const growthStore = createResourceStore<CorpusGrowth>({
  name: 'corpus-growth',
  fetcher: () => adminAPI.get('/stats/growth', CorpusGrowthSchema),
});

export interface CorpusGrowthHook {
  growth: CorpusGrowth | null;
  loading: boolean;
}

export function useCorpusGrowth(): CorpusGrowthHook {
  const { data, status, ensureLoaded } = growthStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { growth: data ?? null, loading: status === 'loading' };
}

// refreshCorpusGrowth —— must be refetched the moment the corpus gains or loses an entry.
// This count **simultaneously** feeds /admin/raw's header, its four tab
// numbers, the sidebar badge, and the pulse bar, so when it isn't refreshed,
// the owner deletes something, the list loses a row, and all four places
// still insist on the old total — contradicting each other on the same
// screen, over a number that's already stopped being true (F-L-16).
// Mutations converge in use-corpus-actions's run(), which already calls
// bumpCorpusEpoch; this call hangs right next to it.
export function refreshCorpusGrowth(): Promise<void> {
  return growthStore.getState().refresh();
}

const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';

// sparkline —— a series of counts → an ASCII block sparkline (normalized to the peak).
export function sparkline(counts: number[]): string {
  const peak = Math.max(1, ...counts);
  const top = SPARK_BLOCKS.length - 1;
  return counts
    .map((c) => SPARK_BLOCKS[Math.min(top, Math.floor((c / peak) * top))])
    .join('');
}

export interface PulseView {
  spark: string;
  total: string;
  delta: string;
  tiers: string;
}

// pulseView —— growth → SystemPulse display strings. null (not loaded) gives an honest placeholder, not a fabricated curve.
export function pulseView(g: CorpusGrowth | null): PulseView {
  if (g === null) {
    return { spark: '·'.repeat(14), total: '—', delta: '—', tiers: 'loading…' };
  }
  return {
    spark: sparkline(g.series.map((d) => d.count)),
    total: String(g.total),
    // "in 7d", not a bare "· 7d". The header is the sparkline's 14-day
    // window, this is the delta's 7-day window — two unrelated windows,
    // reduced to bare tokens sitting side by side, read as a range switcher
    // that switches nothing (F-C-7: I actually went and clicked that "7d"
    // during a cold sweep). Let every number say for itself which span it's measuring.
    delta: `${g.delta_7d >= 0 ? '+' : ''}${g.delta_7d} in 7d`,
    tiers: `${g.by_tier.raw} raw · ${g.by_tier.wiki} wiki · ${g.by_tier.output} out`,
  };
}
