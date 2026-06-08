// composer-keys —— textarea 版 composer 的两块 presentation 禁区逻辑:
//   1. useAutoGrowTextarea —— 输入框随内容撑高,到视口 40% 封顶后内部滚
//      ("对话栏弄超大,但要有上限")。
//   2. dispatchComposerKey —— Enter 提交 / Shift+Enter 换行 / IME 组字中
//      不误投 / 其余键交给 ghost(Tab 接受、Esc 切换)。
// ChatRoom composer + AskInput(hero) 共用。

import { useEffect, type KeyboardEvent, type RefObject } from 'react';

import { dispatchGhostKey } from '@/lib/visitor/ghost-text';

// 输入框最多撑到视口高 40%,再高内部滚 —— 大到能读一整段,又不至于盖掉对话。
const MAX_VIEWPORT_RATIO = 0.4;

// useAutoGrowTextarea —— value 变就重算高度:先归零量 scrollHeight(否则只增
// 不减),再 clamp 到 max;触顶后开 overflow-y 让内部滚而不是继续撑。
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
): void {
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    el.style.height = 'auto';
    const max = Math.round(window.innerHeight * MAX_VIEWPORT_RATIO);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [ref, value]);
}

interface ComposerKeyHandlers {
  ghost: string | null;
  onSubmit: () => void;
  onAccept: (g: string) => void;
  onCycle: () => void;
}

// dispatchComposerKey —— textarea keydown 派发。Enter(无 shift、非 IME 组字)
// = 提交并吃掉默认换行;其余交给 ghost。nativeEvent.isComposing 守卫让中文
// /日文输入法在选字回车时不会把半成品当成提交。
export function dispatchComposerKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  h: ComposerKeyHandlers,
): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    h.onSubmit();
    return;
  }
  dispatchGhostKey(e, h.ghost, { onAccept: h.onAccept, onCycle: h.onCycle });
}
