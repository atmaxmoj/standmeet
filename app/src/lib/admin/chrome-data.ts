// chrome-data —— admin chrome 用的静态展示数据（ticker / pulse）。
// backend 暂未暴露这些 metric；先固定占位，等接口出来再换。

export interface TickerItem {
  t: string;
  evt: 'ingest' | 'visitor' | 'private-hit' | 'promote' | 'connector';
  detail: string;
}

export const ACTIVITY_PLACEHOLDER: readonly TickerItem[] = [
  { t: '18:42', evt: 'ingest',      detail: 'cursor · architecture note · 312 chars' },
  { t: '18:36', evt: 'visitor',     detail: 'anon · OPENAI-A2X · 4 turns' },
  { t: '18:21', evt: 'promote',     detail: 'wiki · "microservices were org chart"' },
  { t: '17:58', evt: 'private-hit', detail: 'session asked about fundraising · scoped out' },
  { t: '17:14', evt: 'connector',   detail: 'gmail · 2 threads pulled' },
  { t: '16:30', evt: 'ingest',      detail: 'claude desktop · clipboard dump' },
];

// 14-day corpus growth (entries / day). Deterministic placeholder until
// backend exposes /api/admin/stats/growth.
export const GROWTH_14D: readonly number[] = [
  3, 5, 2, 6, 4, 7, 3,
  5, 9, 4, 8, 6, 11, 7,
];

