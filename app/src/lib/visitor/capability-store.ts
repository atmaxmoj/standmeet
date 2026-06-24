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
// H.10 之后 agent loop 搬 backend，原来的 zustandCapabilityStateSource()
// adapter (给 agent-core CapabilityStateSource port 用) 已无人 import，删
// 干净。VisitorTurnAgent 通过 SSE capability_state_changed 事件接收，不再
// 走 port pull 模型。

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { CapabilityState } from '@standmeet/agent-core';


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
