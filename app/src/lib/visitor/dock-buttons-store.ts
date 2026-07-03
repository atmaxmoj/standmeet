// dock-buttons-store.ts —— #109/#110 visitor session 的 chat dock 按钮全局 store。
// POST /api/v1/sessions 响应里的 dock_buttons（owner 在 role 上配的 ≤2 个，已过滤 code-deny）
// 首次 set；ChatRoom 读它渲染两个位的按钮，点击把 trigger 当访客消息发出。

import { create } from 'zustand';

import type { PublicSessionDockButton } from '@standmeet/sdk-core';

interface DockButtonsStoreState {
  buttons: readonly PublicSessionDockButton[];
  setButtons: (b: readonly PublicSessionDockButton[]) => void;
  clear: () => void;
}

export const useDockButtonsStore = create<DockButtonsStoreState>()((set) => ({
  buttons: [],
  setButtons: (b) => set({ buttons: b }),
  clear: () => set({ buttons: [] }),
}));
