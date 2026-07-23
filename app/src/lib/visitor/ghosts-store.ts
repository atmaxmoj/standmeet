// ghosts-store.ts —— Ghost steering P4: visitor chat 输入框的**单条** ghost text（不再是队列 + cycle）。
//
// 来源:
//   - POST /api/v1/sessions 响应 `ghosts` → seed。取**首条**当单个 initial ghost（QR/landing 那组
//     suggested question 保留在 code.ghosts，但输入框只吃第一条）。
//   - SSE `ghost` 帧（backend policy done 之后出，code-accessor only）→ setPolicy，**替换**掉当前那条。
//
// 消费:
//   - AskInput / ChatRoom / FloatingChatDock 渲当前 ghost；Tab → fill input 不自动 submit；
//     开始打字 → ghost 被 input.value 自然遮住。**Esc 不再 cycle**（单条，没有下一条可切）。
//
// non-code visitor (public / byoai) 永远 seed 空 → ghost === null → 不渲。三种 mode 同套代码。
//
// source ('initial' | 'policy') 给后台日志区分：seed = 'initial'，policy 帧 = 'policy'。

import { create } from 'zustand';

export type GhostSource = 'initial' | 'policy';

export interface Ghost {
  readonly text: string;
  readonly source: GhostSource;
  // targetWaypoint —— policy ghost 携带（引导到哪个 waypoint）；initial 无。
  readonly targetWaypoint?: string;
}

interface GhostsState {
  ghost: Ghost | null;
  // shownIDs —— ghost text → backend row id 的反查表。useGhostLogger POST shown 拿到 id 后写一行；
  // 别的 hook instance（mode 切换 ChatRoom remount）见有就不再 POST，避免重复落 row；accept 也 lookup。
  shownIDs: Record<string, string>;
  // seed —— 首次拿到 session 时取 items[0] 当单个 initial。重复调用整盘重置（新 session → 老 ghost 不再展示）。
  seed: (items: readonly string[]) => void;
  // setPolicy —— SSE `ghost` 帧到了，把当前 ghost 换成这条 policy ghost（source='policy'）。
  // policy ghost 已在后端 policy 落库（RecordPolicy），帧带 ghostId → 直接 markShown，
  // 前端不再 POST /shown（否则 dup row）。
  setPolicy: (text: string, ghostId?: string, targetWaypoint?: string) => void;
  // markShown —— useGhostLogger POST shown 成功后写 text → row id 映射。
  markShown: (text: string, id: string) => void;
  // clear —— chat.reset 时清干净，避免老 ghost 污染新对话。
  clear: () => void;
  // clearGhost —— F-A-9:policy 沉默的 turn 收尾时只清当前那条 ghost（留着 shownIDs 让在途的
  // /shown 日志仍能反查),避免陈旧 steering ghost 挂在输入框上。
  clearGhost: () => void;
}

export const useGhostsStore = create<GhostsState>((set, get) => ({
  ghost: null,
  shownIDs: {},
  seed: (items) => set({
    ghost: items.length > 0 ? { text: items[0]!, source: 'initial' } : null,
  }),
  setPolicy: (text, ghostId, targetWaypoint) => {
    if (text === '') return;
    set({ ghost: { text, source: 'policy', targetWaypoint } });
    // 后端已落库，帧带 id → 直接记进 shownIDs，logger 见有就不再 POST /shown。
    if (ghostId !== undefined && ghostId !== '') {
      const cur = get().shownIDs;
      set({ shownIDs: { ...cur, [text]: ghostId } });
    }
  },
  markShown: (text, id) => {
    const cur = get().shownIDs;
    if (cur[text] === id) return;
    set({ shownIDs: { ...cur, [text]: id } });
  },
  clear: () => set({ ghost: null, shownIDs: {} }),
  clearGhost: () => set({ ghost: null }),
}));

// useCurrentGhost —— React-friendly hook，组件 subscribe 当前那条（只要 text）。
export function useCurrentGhost(): string | null {
  return useGhostsStore((s) => s.ghost?.text ?? null);
}

// useCurrentGhostMeta —— 后台日志路径用，把 source 一并暴露（use-ghost-logger POST shown 要带）。
export function useCurrentGhostMeta(): Ghost | null {
  return useGhostsStore((s) => s.ghost);
}
