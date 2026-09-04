// use-inference-usage —— #106 data layer for the billing panel. GET
// /api/admin/inference-usage fetches the owner's LLM usage for the last 7
// days (aggregated by day×model + a total). Read-only, fetched once on mount.

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const UsageRowSchema = z.object({
  date: z.string(),
  model: z.string(),
  calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});
const UsageTotalSchema = z.object({
  calls: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});
const UsageRespSchema = z.object({
  rows: z.array(UsageRowSchema),
  total: UsageTotalSchema,
});
export type UsageRow = z.infer<typeof UsageRowSchema>;
// UsageTotal —— the shape of the totals row. Exported on its own so the component can express "not yet fetched" as `| null`.
export type UsageTotal = UsageResp['total'];
export type UsageResp = z.infer<typeof UsageRespSchema>;

const usageStore = createResourceStore<UsageResp>({
  name: 'inference-usage',
  fetcher: () => adminAPI.get('/inference-usage', UsageRespSchema),
});

export interface InferenceUsageHook {
  rows: readonly UsageRow[];
  // total —— **null = not yet fetched** (F-L-53). This used to be a
  // three-zero `EMPTY_TOTAL`, so the panel would report `0 calls / 0 in / 0
  // out` while still loading, followed by "no owner-key LLM calls in the last
  // 7 days" — leading the owner to think this instance had never spent money.
  total: UsageResp['total'] | null;
  // status —— handed to ListPane to decide the three states (still fetching / failed to fetch / fetched).
  status: ResourceStatus;
}

// totalCells —— the three cells of the totals row. `null` always becomes
// `—`: **reporting a zero is an assertion that this instance never spent
// money**, and while loading it doesn't know that yet (F-L-53). The
// null-check lives here so the component layer stays at cyclo ≤ 3.
export function totalCells(
  total: UsageTotal | null, labels: { calls: string; in: string; out: string },
): { label: string; value: string }[] {
  return [
    { label: labels.calls, value: cell(total, (x) => x.calls) },
    { label: labels.in, value: cell(total, (x) => x.input_tokens) },
    { label: labels.out, value: cell(total, (x) => x.output_tokens) },
  ];
}

function cell(total: UsageTotal | null, pick: (t: UsageTotal) => number): string {
  return total === null ? '—' : pick(total).toLocaleString();
}

// UsageSeries —— one model's daily token usage, ready for a per-model sparkline. Days are the
// shared x-axis (every date in the window, ascending); a model with no calls on a day is 0.
export interface UsageSeries {
  model: string;
  values: number[];
  labels: string[];
}

// usageSeries —— pivot the day×model rows into one series per model (y = input+output tokens,
// the billing magnitude — "one line per model"). The backend already aggregates one row per
// (date, model), so the token map has no collisions. Dates ascending (time left→right),
// models alphabetical.
export function usageSeries(rows: readonly UsageRow[]): UsageSeries[] {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const models = [...new Set(rows.map((r) => r.model))].sort();
  const tokens = new Map(
    rows.map((r) => [`${r.date}|${r.model}`, r.input_tokens + r.output_tokens] as const),
  );
  return models.map((m) => ({
    model: m,
    labels: dates,
    values: dates.map((d) => tokens.get(`${d}|${m}`) ?? 0),
  }));
}

export function useInferenceUsage(): InferenceUsageHook {
  const { data, status, ensureLoaded } = usageStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? null,
    status,
  };
}
