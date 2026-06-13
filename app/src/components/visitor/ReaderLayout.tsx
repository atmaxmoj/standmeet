// ReaderLayout —— wiki reader 两列骨架,对齐设计 wiki-frame(240px + 1fr,全宽不
// 居中)。**文档整体滚动**(避免内滚容器够不到底);左 toc 贴左沿 + border-right
// 分割线 + sticky 钉在 session strip(29px)下面 + 自己 overflow-y 滚(长树独立滚);
// 中间一条可拖的把手调 toc 宽;右正文走文档流。
//
// aside / children 都由 server page 传进来(client 组件可接 server 子树作 props)。

'use client';

import type { ReactNode } from 'react';

import { useResizableWidth } from '@/lib/visitor/use-resizable';

// STRIP_H —— SessionStrip 的高(sticky top:0)。toc sticky 钉在它下面,别重叠。
const STICKY_TOP = 'top-[30px] max-h-[calc(100dvh-30px)]';

export function ReaderLayout({ aside, children, mainTestId }: {
  aside: ReactNode;
  children: ReactNode;
  mainTestId: string;
}) {
  const { width, startDrag, dragging } = useResizableWidth();
  return (
    <div className="flex items-start">
      <aside
        className={`hidden lg:block shrink-0 self-start sticky ${STICKY_TOP} overflow-y-auto`}
        // eslint-disable-next-line no-restricted-syntax -- toc width is drag-controlled, runtime-dynamic
        style={{ width }}
        data-testid="wiki-toc"
      >
        {aside}
      </aside>
      {/* 分割线 = 这条把手的 border-left。self-stretch → 撑满整行(文章)高度,
          所以竖线全高,不只到 toc 内容底。同时它就是拖拽热区。 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="resize sidebar"
        onPointerDown={startDrag}
        className={[
          'hidden lg:block shrink-0 self-stretch w-1 cursor-col-resize border-l transition-colors',
          dragging ? 'border-(--color-accent)' : 'border-(--color-rule) hover:border-(--color-accent)',
        ].join(' ')}
        data-testid="wiki-toc-resize"
      />
      <main className="flex-1 min-w-0 px-6 lg:px-10" data-testid={mainTestId}>
        {children}
      </main>
    </div>
  );
}
