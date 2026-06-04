// ask-visitor-store —— I.1: 追踪每张 AskVisitorCard 是否已被 visitor 点选。
// 一旦点了 → 进 answered set；card 看到自己在 set 里 → buttons disabled +
// 显示选中那条。
//
// key = dialog id (useChat 生成的 `d1` / `d2` / ...)。同一 dialog 只可能
// 一条 ask_visitor (LLM 应该自己控制；MaxIterations 兜底)，所以 dialog
// id 当 key 够用，不必拼 toolIndex。
//
// chat reset 时 clear()。

import { create } from 'zustand';

interface AskVisitorState {
  answered: Record<string, string>; // dialogID → "selected text" snapshot
  markAnswered: (dialogID: string, snapshot: string) => void;
  isAnswered: (dialogID: string) => boolean;
  pickAnswer: (dialogID: string) => string | null;
  clear: () => void;
}

export const useAskVisitorStore = create<AskVisitorState>((set, get) => ({
  answered: {},
  markAnswered: (dialogID, snapshot) => {
    const cur = get().answered;
    if (cur[dialogID] !== undefined) return;
    set({ answered: { ...cur, [dialogID]: snapshot } });
  },
  isAnswered: (dialogID) => get().answered[dialogID] !== undefined,
  pickAnswer: (dialogID) => get().answered[dialogID] ?? null,
  clear: () => set({ answered: {} }),
}));
