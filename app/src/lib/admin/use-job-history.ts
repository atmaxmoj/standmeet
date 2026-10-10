// use-job-history —— /admin/listings' history view: the owner's seen ledger, newest first, one page at
// a time, grouped by the UTC day each posting was first seen (job-loop roadmap 8.3.b). The same rows
// MCP jobs.history answers.

import { z } from 'zod';

import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';

const SeenRowSchema = z.object({
  job_seen_id: z.string(),
  first_seen_at: z.string(),
  status: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  source: z.string(),
  application_id: z.string().nullable(),
  score: z.number().optional(),
  reason: z.string().optional(),
  deductions: z.array(z.object({ points: z.number(), why: z.string() })).optional(),
  interview_reports: z.array(z.string()).optional(),
});
export type SeenRow = z.infer<typeof SeenRowSchema> & { id: string };

const historyPage = createPagedStore({
  name: 'job-history', path: '/listings/history',
  item: SeenRowSchema.transform((r) => ({ ...r, id: r.job_seen_id })),
});

export interface DayGroup {
  day: string;
  rows: readonly SeenRow[];
}

// groupByDay —— consecutive rows of the same UTC day, in the order they came (newest first).
export function groupByDay(rows: readonly SeenRow[]): DayGroup[] {
  const out: { day: string; rows: SeenRow[] }[] = [];
  for (const r of rows) {
    const day = r.first_seen_at.slice(0, 10);
    const last = out.at(-1);
    if (last?.day === day) last.rows.push(r);
    else out.push({ day, rows: [r] });
  }
  return out;
}

// assessmentLines —— what the owner's AI noted, as lines: the reason, then each deduction.
export function assessmentLines(r: SeenRow): string[] {
  const deductions = (r.deductions ?? []).map((d) => `${d.points} · ${d.why}`);
  return [r.reason ?? '', ...deductions, ...(r.interview_reports ?? [])].filter((l) => l !== '');
}

export interface JobHistoryHook {
  days: DayGroup[];
  loading: boolean;
  page: PagedState<SeenRow>;
}

export function useJobHistory(): JobHistoryHook {
  const page = usePaged(historyPage);
  return {
    days: groupByDay(page.items),
    loading: page.status === 'idle' || page.status === 'loading',
    page,
  };
}
