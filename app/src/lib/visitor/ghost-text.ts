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

// composerPlaceholder —— ghost 由覆盖层渲的那些输入框用这个,而不是 pickPlaceholder。
//
// ghost 在场时 placeholder 必须**让位成空**:两层都画就会叠字。prod 上就是这样 ——
// ghost 的第一行和 "ask…" 糊在一起,读出来是 "Ẏsḵu.mentioned"。e2e 只量了 ghost 元素的几何,
// 量不出它背后还压着另一串字,是拿眼睛看出来的。
//
// locked 仍然压过一切:锁住时输入框是禁用的,pickGhost 早就返回 null 了,这里只是把顺序写死。
export function composerPlaceholder(p: PlaceholderInputs): string {
  if (p.locked) return p.lockedText;
  if (p.ghost !== null && p.ghost !== '') return '';
  return p.fallback;
}

interface GhostHandlers {
  onAccept: (g: string) => void;
}

// dispatchGhostKey —— Tab 派发（P4 单条 ghost：Esc 不再 cycle，没有下一条可切）。命中 Tab 调
// onAccept + preventDefault；其他键 / ghost 空时无操作。
export function dispatchGhostKey(
  e: KeyboardEvent<HTMLElement>,
  ghost: string | null,
  h: GhostHandlers,
): void {
  if (ghost === null || ghost === '') return;
  if (e.key === 'Tab') {
    e.preventDefault();
    h.onAccept(ghost);
  }
}
