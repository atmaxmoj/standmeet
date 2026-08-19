// dashboard-view —— 仪表盘的**呈现层数据**：把「可能还没拿到」的 stats 变成一屏可以直接渲的值。
//
// 为什么它必须在 lib 而不是在组件里（F-L-52）：
// 那一屏曾经在 `loading…` 的同一帧上说出 `↑ 0 total`、`at zero`、`0 entries · total`、
// `nothing new in 14d`、以及最狠的「Nothing pending — corpus is current.」——
// 大数字诚实地印着 `—`，而**由这些数字长出来的每一句话**都在断言零。
//
// 修法不是在组件里到处补 `loading &&`（那还是纪律）。这里做一件事：
// **没有数的时候，连"句子"都不生成** —— 组件拿到的就是 `undefined`，它没有东西可渲。
// 呈现层守 cyclo ≤ 3 + 禁 if，所以分支只能住在这儿；这也正是产品里已有的做法
// （`use-corpus-growth` 的 `pulseView`、`jobs-loop-view`）。

import type { ActionItem, DashboardStats } from '@/lib/admin/use-admin-dashboard';
import { allActionItems } from '@/lib/admin/use-admin-dashboard';

// DASH —— 「还不知道」的记号。跟四个大数字用的是同一个字符：一个横杠不断言任何事，
// 而这一屏的每一句话都会被 owner 当成结论。
const DASH = '—';

export interface KpiCard {
  key: string;
  label: string;
  // value —— 已经成型的文本（数字或 `—`）。组件不做格式化，也就不会漏掉 null 那一支。
  value: string;
  // trend / sub —— 没数据时**不存在**（不是空串）：这一格的两行小字都是从数字推出来的话。
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

// PulseView —— pulse 卡的一屏。`verdict` 为 undefined = 这一刻答不出「这 14 天有没有动静」。
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

// needsItems —— 「needs your hand」那一格。**undefined 和空数组不是一回事**：
// 空数组说的是「都看过了，没事」，undefined 说的是「还不知道」。
// 前者 owner 可以据此收工，后者不行。
export function needsItems(s: DashboardStats | null): ActionItem[] | undefined {
  return s ? allActionItems(s).filter((i) => i.count > 0) : undefined;
}
