// composer-keys —— the two pieces of logic banned from the presentation
// layer for the textarea-based composer:
//   1. useAutoGrowTextarea —— the input box grows with its content, capping
//      at 40% of the viewport and scrolling internally past that
//      ("let the composer get big, but keep a ceiling").
//   2. dispatchComposerKey —— Enter submits / Shift+Enter inserts a
//      newline / no accidental submit while an IME is composing / all
//      other keys are handed to ghost (Tab accepts, Esc cycles).
// Shared by the ChatRoom composer and AskInput (hero).

import { useEffect, type KeyboardEvent, type RefObject } from 'react';

import { dispatchGhostKey } from '@/lib/visitor/ghost-text';

// The input box grows to at most 40% of viewport height, then scrolls
// internally — big enough to read a whole paragraph, without covering the
// conversation.
const MAX_VIEWPORT_RATIO = 0.4;

// useAutoGrowTextarea —— recomputes height whenever value changes: first
// zero out the height to measure scrollHeight fresh (otherwise it only ever
// grows, never shrinks), then clamp to max; once it hits the ceiling, turn
// on overflow-y so it scrolls internally instead of growing further.
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
}

// dispatchComposerKey —— textarea keydown dispatch. Enter (no shift, not
// mid-IME-composition) = submit and swallow the default newline; every
// other key goes to ghost. The nativeEvent.isComposing guard stops a
// Chinese/Japanese IME's confirm-selection Enter from being treated as a
// submit while the text is still half-formed.
export function dispatchComposerKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  h: ComposerKeyHandlers,
): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    h.onSubmit();
    return;
  }
  dispatchGhostKey(e, h.ghost, { onAccept: h.onAccept });
}
