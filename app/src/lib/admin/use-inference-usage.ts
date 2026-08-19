// use-inference-usage —— #106 计费面板数据层。GET /api/admin/inference-usage 拿 owner
// 近 7 天 LLM 用量(按天×model 聚合 + 合计)。只读,mount 时拉一次。

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
// UsageTotal —— 合计那一行的形状。单独导出，好让组件把「没拉到」表达成 `| null`。
export type UsageTotal = UsageResp['total'];
export type UsageResp = z.infer<typeof UsageRespSchema>;

const usageStore = createResourceStore<UsageResp>({
  name: 'inference-usage',
  fetcher: () => adminAPI.get('/inference-usage', UsageRespSchema),
});

export interface InferenceUsageHook {
  rows: readonly UsageRow[];
  // total —— **null = 还没拉到**（F-L-53）。原来这里是一份三个零的 `EMPTY_TOTAL`，
  // 于是面板在加载中就报出 `0 calls / 0 in / 0 out`，下面还跟着一句
  // 「no owner-key LLM calls in the last 7 days」—— owner 据此以为这台实例没花过钱。
  total: UsageResp['total'] | null;
  // status —— 交给 ListPane 判三态（还在拉 / 没拉到 / 拉到了）。
  status: ResourceStatus;
}

// totalCells —— 合计那一行的三格。`null` 一律成 `—`：**报一个零就是断言这台实例没花过钱**，
// 而加载中它还不知道（F-L-53）。判空放在这儿，组件那层守 cyclo ≤ 3。
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

export function useInferenceUsage(): InferenceUsageHook {
  const { data, status, ensureLoaded } = usageStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? null,
    status,
  };
}
