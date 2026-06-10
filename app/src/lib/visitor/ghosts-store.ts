// ghosts-store.ts —— H.13.d/e: visitor chat 输入框灰色 ghost text 队列。
//
// 来源:
//   - POST /api/v1/sessions 响应 `ghosts` → seed (初始队列)
//   - SSE `ghosts` 帧 (backend agent_turn 收尾 emit, code-accessor only)
//     → append (每轮 AI 答完追加 3 条 follow-up)
//
// 消费:
//   - AskInput / ChatRoom / FloatingChatDock 渲 current() 当 ghost；按 Tab
//     fill input + 不自动 submit；Esc cycle 下一条；开始打字 ghost 自然
//     被 input.value 隐藏
//
// non-code visitor (public / byoai) 永远 seed 空数组、永远不收 SSE 帧 →
// current() === null → ghost 不渲。同套代码兼容三种 mode。
//
// H.13.e: 每条 ghost 带 source ('initial' | 'followup') 让后台日志区分；
// seed 默认 'initial'，append 默认 'followup'。

import { create } from 'zustand';

export type GhostSource = 'initial' | 'followup';

export interface Ghost {
  readonly text: string;
  readonly source: GhostSource;
}

interface GhostsState {
  ghosts: readonly Ghost[];
  index: number;
  // shownIDs —— H.13.e: ghost text → backend row id 的反查表。useGhost
  // Logger POST shown 拿到 id 后写一行；其他 hook instance (mode 切换换
  // ChatRoom mount 时) 见这里有就不再 POST，避免重复落 row。同步对 accept
  // 拿 id 也提供 lookup。
  shownIDs: Record<string, string>;
  // seed —— 首次拿到 session 时塞初始队列。重复调用整盘重置 (新 session
  // 来了 → 老 ghost 不该再展示)。空数组也算重置。source 默认 'initial'。
  seed: (items: readonly string[]) => void;
  // append —— SSE ghosts 帧到了往尾巴推；不重置 index。source
  // 默认 'followup'。
  append: (items: readonly string[]) => void;
  // cycle —— Esc 触发，index 进位；到尾回 0 让 visitor 循环看。
  cycle: () => void;
  // markShown —— useGhostLogger POST shown 成功后写 text → row id 映射。
  markShown: (text: string, id: string) => void;
  // clear —— chat.reset 时清干净，避免老队列污染新对话。
  clear: () => void;
}

export const useGhostsStore = create<GhostsState>((set, get) => ({
  ghosts: [],
  index: 0,
  shownIDs: {},
  seed: (items) => set({
    ghosts: items.map<Ghost>((text) => ({ text, source: 'initial' })),
    index: 0,
  }),
  append: (items) => {
    if (items.length === 0) return;
    const cur = get().ghosts;
    const incoming = items.map<Ghost>((text) => ({ text, source: 'followup' }));
    // index 推进到第一条新 followup —— 答完一轮后输入框直接显 AI 的「接着问」,
    // 不再卡在 seed[0](原始 bug:append 不动 index,ghost 永远是初始那条)。
    set({ ghosts: [...cur, ...incoming], index: cur.length });
  },
  cycle: () => {
    const { ghosts, index } = get();
    if (ghosts.length === 0) return;
    set({ index: (index + 1) % ghosts.length });
  },
  markShown: (text, id) => {
    const cur = get().shownIDs;
    if (cur[text] === id) return;
    set({ shownIDs: { ...cur, [text]: id } });
  },
  clear: () => set({ ghosts: [], index: 0, shownIDs: {} }),
}));

// useCurrentGhost —— React-friendly hook，组件 subscribe 当前指针那条
// (只要 text，渲染层不需要 source)。
export function useCurrentGhost(): string | null {
  return useGhostsStore((s) => pickCurrent(s.ghosts, s.index)?.text ?? null);
}

// useCurrentGhostMeta —— 后台日志路径用，把 source 一并暴露 (use-ghost
// -logger 里调 POST sessions/{id}/ghosts/shown 时要带)。
export function useCurrentGhostMeta(): Ghost | null {
  return useGhostsStore((s) => pickCurrent(s.ghosts, s.index));
}

function pickCurrent(ghosts: readonly Ghost[], index: number): Ghost | null {
  if (ghosts.length === 0) return null;
  return ghosts[index] ?? null;
}
