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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// readUiHtml —— 从 CapabilityState.extra 取 ui.html（无则空串），不用类型断言。
function readUiHtml(extra: unknown): string {
  if (!isRecord(extra)) return '';
  const ui = extra['ui'];
  if (!isRecord(ui)) return '';
  return typeof ui['html'] === 'string' ? ui['html'] : '';
}

function matchesTool(id: string, toolName: string): boolean {
  return id === toolName || toolName.startsWith(`${id}_`);
}

// uiHtmlForTool —— 给一个 tool 名，找它所属能力自带的 ui:// 卡 HTML（外置 MCP app
// 在 CapabilityState.extra.ui.html）。外置内建用 raw 名 → 能力 id === tool 名；带
// 前缀的第三方插件 → tool 名以 <id>_ 开头。找不到 / 无 html → 空串（回退写死卡）。
export function uiHtmlForTool(
  states: readonly CapabilityState[], toolName: string,
): string {
  const match = states.find((s) => matchesTool(s.id, toolName));
  return match ? readUiHtml(match.extra) : '';
}
