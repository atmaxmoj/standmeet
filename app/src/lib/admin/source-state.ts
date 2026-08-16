// source-state.ts —— /admin/sources 每一行右侧那句话，由数据推出来。
//
// 这一页要回答的是「我这个源还活着吗」，所以状态有**三种**，不是两种：
//   · 从没试过        → `never fetched`
//   · 试过、失败了    → `last try · <日期> · failed — <原因>`
//   · 试过、成功了    → `last · <日期>`
//
// 以前只有 `last_fetched_at` 一个来源，于是**取过但每次都失败**的源印的是
// `never fetched` —— 跟一个从没被碰过的源一模一样（F-E-18：真环境里三行都这样，
// 而失败详情只活在 owner 那一次 MCP 调用的回执里，关掉窗口就没了）。
//
// 推导住在这里而不是组件里：呈现层不写 if。

import type { AdminSourceRow } from '@/lib/admin/use-admin-sources';

export function sourceFailed(row: AdminSourceRow): boolean {
  return (row.last_error ?? '') !== '';
}

export function sourceStateLine(row: AdminSourceRow): string {
  return sourceFailed(row)
    ? `last try · ${dayOf(row.last_attempted_at)} · failed — ${row.last_error ?? ''}`
    : lastFetched(row.last_fetched_at);
}

function lastFetched(iso: string | null | undefined): string {
  return iso ? `last · ${iso.slice(0, 10)}` : 'never fetched';
}

function dayOf(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}
