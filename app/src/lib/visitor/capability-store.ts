// capability-store.ts —— visitor session 的 capability state 全局 store。
//
// 来源:
//   - POST /api/v1/sessions 响应里的 capabilities 数组 → 首次 setStates
//   - 任何 POST /sessions/{id}/tools/{name} 响应都带 capability_state →
//     dispatcher 调完更新 (cascade invariant)
//
// 消费:
//   - SessionStrip / banner 渲 quota / disabled cap 提示
//   - agent-core 装 LLM toolset 时按 enabled cap 过滤
//
// agent-core 的 CapabilityStateSource port 通过 zustandCapabilityStateSource
// 适配器读这里。

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type {
  CapabilityState, CapabilityStateSource,
} from '@standmeet/agent-core';

interface CapabilityStoreState {
  states: readonly CapabilityState[];
  setStates: (s: readonly CapabilityState[]) => void;
  clear: () => void;
}

export const useCapabilityStore = create<CapabilityStoreState>()(
  subscribeWithSelector((set) => ({
    states: [],
    setStates: (s) => set({ states: s }),
    clear: () => set({ states: [] }),
  })),
);

// zustandCapabilityStateSource —— agent-core CapabilityStateSource port
// 适配器。current() 同步读 store；onChange 走 zustand subscribe。
export function zustandCapabilityStateSource(): CapabilityStateSource {
  return {
    current: () => useCapabilityStore.getState().states,
    onChange: (cb) => {
      return useCapabilityStore.subscribe(
        (s) => s.states,
        (states) => { cb(states); },
      );
    },
  };
}
