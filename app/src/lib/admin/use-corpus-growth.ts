// use-corpus-growth —— Monitor/SystemPulse 数据层。GET /api/admin/stats/growth 拿真 corpus
// 14 天新增序列 + 7 天增量 + 分层总量。只读,mount 拉一次。分支/格式化都在这(lib),让
// SystemPulse 组件保持无 if。

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

// growthStore —— **这一份计数只有这一个家**。侧栏 pulse 栏、/admin/raw 的标题与 tab、
// 侧栏 badge、以及 dashboard 的那张 pulse 卡，读的都得是它（F-C-31）。
//
// dashboard 曾经自己再 `fetch('/api/admin/stats/growth')` 一次：同一个端点、两次请求、
// 两个时刻。中间只要进了一条语料，同一屏上就会出现「rail 说 +2 in 7d」而「卡片说
// nothing new in 14d」—— 7 天是 14 天的**子集**，两句话不可能同时成立。
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

// refreshCorpusGrowth —— 语料一有增删就必须重拉这份计数。
// 这一份**同时**喂着 /admin/raw 的标题数、四个 tab 的数、侧栏 badge 和 pulse 栏,
// 所以它不刷新的时候,owner 删掉一条之后列表少了一行、而四个地方还一起坚称原来的总数 ——
// 同一屏之内自相矛盾,而且它们说的那个数已经不成立了(F-L-16)。
// mutation 收口在 use-corpus-actions 的 run() 里,那里已经在 bumpCorpusEpoch,这条挂在旁边。
export function refreshCorpusGrowth(): Promise<void> {
  return growthStore.getState().refresh();
}

const SPARK_BLOCKS = '▁▂▃▄▅▆▇█';

// sparkline —— 一串计数 → ASCII 方块火花线(按峰值归一)。
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

// pulseView —— growth → SystemPulse 展示串。null(未加载)给诚实占位,不编假曲线。
export function pulseView(g: CorpusGrowth | null): PulseView {
  if (g === null) {
    return { spark: '·'.repeat(14), total: '—', delta: '—', tiers: 'loading…' };
  }
  return {
    spark: sparkline(g.series.map((d) => d.count)),
    total: String(g.total),
    // "in 7d",不是裸的 "· 7d"。标题那边是火花线的 14 天窗口,这边是增量的 7 天窗口 ——
    // 两个不相干的窗口一旦都缩成裸令牌并排放着,整块就读成了一个范围切换器,而它谁也切不了
    // (F-C-7:我在冷扫时真去点了那个 "7d")。让每个数字自己说清楚量的是哪一段。
    delta: `${g.delta_7d >= 0 ? '+' : ''}${g.delta_7d} in 7d`,
    tiers: `${g.by_tier.raw} raw · ${g.by_tier.wiki} wiki · ${g.by_tier.output} out`,
  };
}
