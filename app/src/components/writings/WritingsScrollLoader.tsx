// WritingsScrollLoader —— IntersectionObserver sentinel at the bottom of
// /writings; when visible and there's a next page, it triggers
// store.loadMore. The status text ("scroll for more" / "loading…" /
// "end of archive") keeps that logic out of the main component.

'use client';

import { useEffect, useRef } from 'react';

interface Props {
  done: boolean;
  loading: boolean;
  onHit: () => void;
}

export function WritingsScrollLoader({ done, loading, onHit }: Props) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useIntersectionTrigger(sentinelRef, !done && !loading, onHit);
  return (
    <div className="mt-10 flex justify-center">
      <div
        ref={sentinelRef}
        data-testid="writings-scroll-sentinel"
        className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)"
      >
        {loadingLabel(done, loading)}
      </div>
    </div>
  );
}

function loadingLabel(done: boolean, loading: boolean): string {
  return loading ? 'loading…' : done ? 'end of archive' : 'scroll for more';
}

function useIntersectionTrigger(
  ref: React.RefObject<HTMLDivElement | null>,
  active: boolean,
  onHit: () => void,
) {
  useEffect(() => {
    const node = ref.current;
    return node && active ? observeNode(node, onHit) : undefined;
  }, [ref, active, onHit]);
}

function observeNode(node: HTMLDivElement, onHit: () => void): () => void {
  const io = new IntersectionObserver((entries) => {
    entries[0]?.isIntersecting && onHit();
  });
  io.observe(node);
  return () => io.disconnect();
}
