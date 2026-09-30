'use client';

import { useEffect, useRef } from 'react';

import type { Dialog } from './dialog-stream.js';

// usePinToBottom —— keeps a chat's scroll box at its bottom as turns arrive and stream (dialogs is a
// fresh array each stream tick), so the newest question and answer are in view. Every surface with
// its own scroll box uses it: the app room, the rail, the dock panel.
export function usePinToBottom<T extends HTMLElement>(dialogs: readonly Dialog[]) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    el && el.scrollTo(0, el.scrollHeight);
  }, [dialogs]);
  return ref;
}
