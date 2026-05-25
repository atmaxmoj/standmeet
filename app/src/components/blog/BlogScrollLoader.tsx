// BlogScrollLoader —— /blog 底部 IntersectionObserver 探测；可见且
// 还有下一页就触发 store.loadMore。状态文本 ("scroll for more" /
// "loading…" / "end of archive") 不挤主组件。

'use client';

import { useEffect, useRef } from 'react';

interface Props {
  done: boolean;
  loading: boolean;
  onHit: () => void;
}

export function BlogScrollLoader({ done, loading, onHit }: Props) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useIntersectionTrigger(sentinelRef, !done && !loading, onHit);
  return (
    <div className="mt-10 flex justify-center">
      <div
        ref={sentinelRef}
        data-testid="blog-scroll-sentinel"
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
