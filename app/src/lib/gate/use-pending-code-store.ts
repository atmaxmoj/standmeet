// use-pending-code-store —— visitor 带着 `?code=ABC` 进站时，code 不留在
// URL 也不直接走参数到下游；先吸进这个内存 store，由 use-absorb-code 这条
// effect 链负责 issue session + clear。
//
// 为什么走 store：URL 上 `?code=` 不安全（截图 / 分享 / referer / history
// 全会泄漏纯码），所以入口 hook 立刻 `history.replaceState` 删 URL —— 但
// 此时 issue session 是 async，需要一个地方暂存 code 让下游 effect 拿到。
// localStorage 不合适（持久化不必要、刷新会复用旧 pending code）；普通
// useState 也不行（hook 之间传不了）。zustand store 是最小的"页面级临时
// state"，符合"客户端状态走 store 不挂 URL" 规约。

import { create } from 'zustand';

interface PendingCodeState {
  code: string | null;
  setCode: (code: string) => void;
  consume: () => string | null;
}

export const usePendingCodeStore = create<PendingCodeState>((set, get) => ({
  code: null,
  setCode: (code) => set({ code }),
  consume: () => {
    const cur = get().code;
    if (cur !== null) set({ code: null });
    return cur;
  },
}));
