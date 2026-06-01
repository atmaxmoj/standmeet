// tool-specs-store.ts —— G-8: visitor session 发的 tool_specs 全 dump 进
// 这个 zustand store，按 name 索引；ConversationDeck / ChatRoom 渲 throbber
// 时按 tool name 读 progress_label。session issue 时 ensureSession 一次性
// 写满；reset 走 clear。
//
// 解决 D-5 留的硬编码 THROBBER_LABELS 两份重复：
//   - tool 跑啥 label 由 backend ToolSpec.ProgressLabel 决定
//   - frontend 只 observe (zustand subscribe)，不再自己列表

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { PublicSessionToolSpec } from '@standmeet/sdk-core';

interface ToolSpecsState {
  // 按 name 索引；undefined 表示 backend 没下发 (fallback "running <name>")
  byName: Record<string, PublicSessionToolSpec>;
  setSpecs: (specs: readonly PublicSessionToolSpec[]) => void;
  clear: () => void;
}

export const useToolSpecsStore = create<ToolSpecsState>()(
  subscribeWithSelector((set) => ({
    byName: {},
    setSpecs: (specs) => set({ byName: indexByName(specs) }),
    clear: () => set({ byName: {} }),
  })),
);

function indexByName(
  specs: readonly PublicSessionToolSpec[],
): Record<string, PublicSessionToolSpec> {
  const out: Record<string, PublicSessionToolSpec> = {};
  for (const s of specs) out[s.name] = s;
  return out;
}
