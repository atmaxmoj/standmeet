// use-model-list —— "Load models" button 的状态机。两个 panel 共用：
// BYOAIPanel (visitor) + AIProviderPanel (admin owner)。
//
// 三种 UI 形态：
//   1) options == null → 文本 input，旁边一个 "Load models" button
//   2) options != null → dropdown <select>，旁边一个 "↻" 重新 fetch + "type
//      manually" 切回 text input
//   3) loading == true → button 显示 "loading…" disabled
//
// 失败：caller 传 onError(message) 在 toast 里弹，options 保持原状（null
// 仍 null / 已加载仍是上次的列表）。
//
// 网络层走 list-models.ts；这里只管状态。

import { useCallback, useState } from 'react';

import {
  listModels, listOwnerModels, type ListModelsInput,
} from '@/lib/inference/list-models';

export interface ModelListState {
  readonly options: readonly string[] | null;
  readonly loading: boolean;
}

export interface ModelListHook {
  state: ModelListState;
  load: (input: ListModelsInput) => Promise<void>;
  // loadOwn —— owner 那一面：**不发 key**，服务端拿它自己存的那把去问（F-R-11）。
  // 访客那面反过来（key 跟着请求走），所以两条路各有一个入口而不是一个带标志位的。
  loadOwn: () => Promise<void>;
  reset: () => void;
}

export function useModelList(onError: (msg: string) => void): ModelListHook {
  const [options, setOptions] = useState<readonly string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (input: ListModelsInput): Promise<void> => {
    setLoading(true);
    try {
      const models = await listModels(input);
      setOptions(models);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'list models failed');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadOwn = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setOptions(await listOwnerModels());
    } catch (e) {
      onError(e instanceof Error ? e.message : 'list models failed');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const reset = useCallback(() => setOptions(null), []);

  return { state: { options, loading }, load, loadOwn, reset };
}
