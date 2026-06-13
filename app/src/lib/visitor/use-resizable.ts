// use-resizable —— 拖分隔线调 wiki toc 宽度。返回 width + startDrag(pointerdown
// 起拖)+ dragging。拖动时挂 window pointermove/up,clamp 到 [MIN,MAX],松手持久化
// 到 localStorage。逻辑放 lib(组件层禁 if),SSR 安全(useEffect 才读 storage)。

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'standmeet-wiki-toc-w';
const MIN = 180;
const MAX = 440;
const DEFAULT = 252;

const clamp = (n: number): number => Math.max(MIN, Math.min(MAX, n));

export function useResizableWidth(): {
  width: number;
  startDrag: (e: React.PointerEvent) => void;
  dragging: boolean;
} {
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: DEFAULT });
  const latest = useRef(DEFAULT);

  useEffect(() => {
    const v = Number(safeGet(KEY));
    if (v) setWidth(clamp(v));
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    start.current = { x: e.clientX, w: latest.current };
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const nw = clamp(start.current.w + ev.clientX - start.current.x);
      latest.current = nw;
      setWidth(nw);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      safeSet(KEY, String(latest.current));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  // keep latest in sync for the next drag's baseline
  useEffect(() => { latest.current = width; }, [width]);

  return { width, startDrag, dragging };
}

function safeGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    typeof window === 'undefined' || window.localStorage.setItem(key, value);
  } catch {
    /* private mode — silent */
  }
}
