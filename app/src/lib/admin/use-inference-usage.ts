// use-inference-usage —— #106 计费面板数据层。GET /api/admin/inference-usage 拿 owner
// 近 7 天 LLM 用量(按天×model 聚合 + 合计)。只读,mount 时拉一次。

'use client';

import { useEffect } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore } from '@/lib/state/create-resource-store';

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
export type UsageResp = z.infer<typeof UsageRespSchema>;

const usageStore = createResourceStore<UsageResp>({
  name: 'inference-usage',
  fetcher: () => adminAPI.get('/inference-usage', UsageRespSchema),
});

export interface InferenceUsageHook {
  rows: readonly UsageRow[];
  total: UsageResp['total'];
  loading: boolean;
}

const EMPTY_TOTAL: UsageResp['total'] = { calls: 0, input_tokens: 0, output_tokens: 0 };

export function useInferenceUsage(): InferenceUsageHook {
  const { data, status, ensureLoaded } = usageStore();
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    rows: data?.rows ?? [],
    total: data?.total ?? EMPTY_TOTAL,
    loading: status === 'loading',
  };
}
