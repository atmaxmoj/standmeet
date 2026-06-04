// ghost-text —— H.13.d ghost text 三件套的 presentation helper。components
// 层禁 `if` + complexity 限 3，把 ghost 渲选 / placeholder 选 / keyboard
// dispatch 这点条件逻辑抽到 lib 这边。所有 AskInput / ChatRoom 输入框 /
// FloatingChatDock 输入框共用。

import type { KeyboardEvent } from 'react';

interface GhostGate {
  // value === '' 才显 ghost；非空 visitor 已经在打字。
  value: string;
  // pending / locked / disabled 任一为 true → 不渲 ghost (输入框 dim)。
  blocked: boolean;
  ghost: string | null | undefined;
}

// pickGhost —— 当下应渲的 ghost；null 表示不渲。
export function pickGhost(g: GhostGate): string | null {
  if (g.blocked) return null;
  if (g.value !== '') return null;
  if (g.ghost === undefined || g.ghost === null || g.ghost === '') return null;
  return g.ghost;
}

interface PlaceholderInputs {
  // locked = quota 用尽之类的硬锁；显 lockedText。
  locked: boolean;
  lockedText: string;
  // ghost 非空 → 当 placeholder 渲；空 → fallback。
  ghost: string | null;
  fallback: string;
}

// pickPlaceholder —— 三态选 (locked > ghost > fallback)。
export function pickPlaceholder(p: PlaceholderInputs): string {
  if (p.locked) return p.lockedText;
  if (p.ghost !== null && p.ghost !== '') return p.ghost;
  return p.fallback;
}

interface GhostHandlers {
  onAccept: (g: string) => void;
  onCycle: () => void;
}

// dispatchGhostKey —— Tab/Esc 派发，命中调对应 handler + preventDefault。
// 其他键 / ghost 空时无操作。
export function dispatchGhostKey(
  e: KeyboardEvent<HTMLInputElement>,
  ghost: string | null,
  h: GhostHandlers,
): void {
  if (ghost === null || ghost === '') return;
  if (e.key === 'Tab') {
    e.preventDefault();
    h.onAccept(ghost);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    h.onCycle();
  }
}
