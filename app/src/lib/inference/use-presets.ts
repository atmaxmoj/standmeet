// use-presets —— provider preset 列表(GET /admin/ai-provider/presets)拉一次。
//
// 两个面用它:默认那条的表单,和 provider 本子的新建行。返 null = 还没拿到
// (调用方据此显示骨架);失败弹 toast 并保持 null —— preset 拉不到就没法选 provider。

'use client';

import { useEffect, useState } from 'react';

import { fetchAIProviderPresets, type AIProviderPresetView } from '@/lib/api/admin';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function usePresets(): readonly AIProviderPresetView[] | null {
  const [presets, setPresets] = useState<AIProviderPresetView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAIProviderPresets()
      .then((list) => setPresets(list))
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : 'failed to load presets');
      });
  }, []);
  useEffectErrorToast(err);
  return presets;
}

// endpointForPreset —— 选中某个 preset 时该填的 base URL(表里没有 = 空,owner 手输)。
export function endpointForPreset(
  name: string, presets: readonly AIProviderPresetView[],
): string {
  return presets.find((p) => p.name === name)?.base_url ?? '';
}
