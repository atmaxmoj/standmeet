import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizableOptions {
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  /** When true, dragging left increases width (for right-side panels). */
  reverse?: boolean;
  /** 'horizontal' (default) resizes width, 'vertical' resizes height. */
  direction?: "horizontal" | "vertical";
  /** localStorage key to persist size across sessions. */
  storageKey?: string;
}

function loadSize(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v) return Number(v) || fallback;
  } catch { /* ignore */ }
  return fallback;
}

export function useResizable({
  defaultWidth,
  minWidth = 120,
  maxWidth = 600,
  reverse = false,
  direction = "horizontal",
  storageKey,
}: UseResizableOptions) {
  const [size, setSize] = useState(() => loadSize(storageKey, defaultWidth));
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const isVertical = direction === "vertical";

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = isVertical ? e.clientY : e.clientX;
      startSize.current = size;
      document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [size, isVertical],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = (isVertical ? e.clientY : e.clientX) - startPos.current;
      const next = Math.min(maxWidth, Math.max(minWidth, startSize.current + (reverse ? -delta : delta)));
      setSize(next);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [minWidth, maxWidth, reverse, isVertical]);

  // Persist to localStorage on change
  useEffect(() => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(size)); } catch { /* ignore */ }
    }
  }, [storageKey, size]);

  // Return "width" alias for backward compat + "size" for generic use
  return { width: size, size, onMouseDown };
}
