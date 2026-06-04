// suggestions-store.ts —— H.13.d: visitor chat 输入框灰色 ghost text 队列。
//
// 来源:
//   - POST /api/v1/sessions 响应 `suggested_questions` → seed (初始队列)
//   - SSE `suggestions` 帧 (backend agent_turn 收尾 emit, code-accessor only)
//     → append (每轮 AI 答完追加 3 条 follow-up)
//
// 消费:
//   - AskInput / ChatRoom / FloatingChatDock 渲 current() 当 ghost；按 Tab
//     fill input + 不自动 submit；Esc cycle 下一条；开始打字 ghost 自然
//     被 input.value 隐藏
//
// non-code visitor (public / byoai) 永远 seed 空数组、永远不收 SSE 帧 →
// current() === null → ghost 不渲。同套代码兼容三种 mode。

import { create } from 'zustand';

interface SuggestionsState {
  ghosts: readonly string[];
  index: number;
  // seed —— 首次拿到 session 时塞初始队列。重复调用整盘重置 (新 session
  // 来了 → 老 ghost 不该再展示)。空数组也算重置。
  seed: (items: readonly string[]) => void;
  // append —— SSE suggestions 帧到了往尾巴推；不重置 index。
  append: (items: readonly string[]) => void;
  // cycle —— Esc 触发，index 进位；到尾回 0 让 visitor 循环看。
  cycle: () => void;
  // clear —— chat.reset 时清干净，避免老队列污染新对话。
  clear: () => void;
}

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  ghosts: [],
  index: 0,
  seed: (items) => set({ ghosts: items, index: 0 }),
  append: (items) => {
    if (items.length === 0) return;
    const cur = get().ghosts;
    set({ ghosts: [...cur, ...items] });
  },
  cycle: () => {
    const { ghosts, index } = get();
    if (ghosts.length === 0) return;
    set({ index: (index + 1) % ghosts.length });
  },
  clear: () => set({ ghosts: [], index: 0 }),
}));

// useCurrentGhost —— React-friendly hook，组件 subscribe 当前指针那条。
// 队列空 / index 越界 → null，组件不渲。
export function useCurrentGhost(): string | null {
  return useSuggestionsStore((s) => pickCurrent(s.ghosts, s.index));
}

function pickCurrent(ghosts: readonly string[], index: number): string | null {
  if (ghosts.length === 0) return null;
  return ghosts[index] ?? null;
}
