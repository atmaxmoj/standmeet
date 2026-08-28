// ReaderLayout —— wiki reader 的骨架：**视口居中的正文** + 左侧贴边的树。
//
// ── 正文为什么用绝对定位把树挪出去 ───────────────────────────────────────────────
//
// 上一版是 `flex`：aside(可拖宽) + 分隔条 + `main flex-1`。于是正文只在**剩下的那段**里
// 居中 —— 树占多宽，正文就偏右多少。读者看到的是一篇没对准的文章，而树越宽偏得越狠。
// 现在正文是 `mx-auto max-w-[920px]`（对**视口**居中，跟 /writings 首页同一口径），
// 树 `absolute` 挂在它左边的留白里，不参与占位，所以正文的位置跟树宽无关。
//
// 顺带去掉了那根可拖宽的分隔条：它存在的意义是"树占多宽由读者定"，而树一旦不再挤正文，
// 这个自由度就不再解决任何问题，只留下一个要维护的拖拽状态。
//
// ── 树被切的时候必须看得出来 ─────────────────────────────────────────────────────
//
// 树 sticky + 自己滚，是一个**取舍**而不是疏忽：要么它跟着整页滚（一个滚动区，什么都
// 够得到，但翻到文章中段树就滚没了），要么常驻但成为第二个滚动区。选后者。
//
// 代价是真实的，而且被撞到过：树比视口高时下半截被切，鼠标在正文上滚它不动，
// 读者的结论是「下面明显还有东西，但我滚不下去」。所以切口必须自己说话 ——
// `styles.railFade` 在底部铺一条渐隐（跟 UX-56 那条 sneak-peek 卡片同一条约定：
// **一张会被切的东西，切口处要有续读信号**）。少了它，被切读起来像"坏了"而不是"还有"。
//
// aside / children 都由 server page 传进来(client 组件可接 server 子树作 props)。

'use client';

import type { ReactNode } from 'react';

import styles from '@/components/visitor/ReaderLayout.module.css';

// STICKY_TOP —— SessionStrip 的高(sticky top:0)。树钉在它下面,别重叠。
const STICKY_TOP = 'top-[30px] max-h-[calc(100dvh-30px)]';

export function ReaderLayout({ aside, children, mainTestId }: {
  aside: ReactNode;
  children: ReactNode;
  mainTestId: string;
}) {
  return (
    <div className="relative">
      {/* 树：xl 以下整个不渲染 —— 窄屏塞不下一棵树，而挤进来的代价是正文没法读。
          绝对定位 = 不占位 = 正文的居中跟它无关。 */}
      <aside
        className={`hidden xl:block absolute left-0 top-0 w-[240px] pl-6 ${styles['rail']}`}
        data-testid="wiki-toc"
      >
        <div className={`sticky ${STICKY_TOP} overflow-y-auto ${styles['railInner']}`}>
          {aside}
        </div>
      </aside>
      <main className="mx-auto max-w-[920px] px-6 min-w-0" data-testid={mainTestId}>
        {children}
      </main>
    </div>
  );
}
