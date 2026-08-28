// /wiki 的外壳 —— 顶栏 + 会话条 + 左侧树，**一次挂载，跨文章不动**。
//
// 为什么必须是 layout 而不是每页各渲一份：
//
// 之前顶栏和树写在 `wiki/page.tsx` 和 `wiki/[...path]/page.tsx` 各自里面。Next 在同级页面
// 之间导航时**会保留 layout、只换 page**，但那两样当时住在 page 里，于是点一篇文章 =
// 整个骨架重挂：树重新渲、每一层重新拉，屏幕上是"树刷了一下"。
// （`admin` 早就是 layout 了，所以 admin 换分区侧栏不闪 —— 同一个结构，wiki 这边一直没有。）
//
// 搬进来之后还顺带解决了滚动：外壳固定，**只有正文那一列自己滚**，读者往下读的时候
// 顶栏和树留在原地，而不是被一起卷走。三个区域各自独立：
//   顶栏 + 会话条 —— 不滚
//   树           —— 自己滚（比视口高时）
//   正文         —— 自己滚
//
// 树的高亮从 **URL** 派生（`WikiTreeView` 内部 `usePathname`），不再由 page 传 prop ——
// 传 prop 的话 layout 就得跟着当前文章变，那它又变回"每篇文章重渲一次"了。

import type { ReactNode } from 'react';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { ReaderChatRail } from '@/components/visitor/ReaderChatRail';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiTreeStats } from '@/lib/api/public';

import styles from '@/app/wiki/wiki-shell.module.css';

export default async function WikiLayout({ children }: { children: ReactNode }) {
  const [instance, stats] = await Promise.all([fetchInstance(), fetchWikiTreeStats()]);
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <WikiTopBar handle={instance.handle} />
      <SessionStrip />
      <div className="flex-1 flex min-h-0 relative">
        {/* 树：绝对定位，不占版面宽度 —— 正文因此是对**视口**居中，而不是在树剩下的那段里居中。
            宽度 = 那条留白本身（见 wiki-shell.module.css）：屏幕越宽树越好读，且永远压不到正文。
            留白不够 260px 时整个不渲染 —— 判据是「这棵树有没有地方站」，不是「屏幕算不算大」。 */}
        <aside className={styles['rail']} data-testid="wiki-toc">
          <WikiTreeView stats={stats} />
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto" data-testid="wiki-scroll">
          <div className="mx-auto max-w-[920px] px-6">{children}</div>
        </main>
        {/* 右栏「问这篇」，跟左边的树对称。**没会话时也渲**：那时它是 BYOAI 的入口 ——
            读者填自己的 key 就能开始问，而不是只有滑到正文最底下才看得见一句提示。 */}
        <ReaderChatRail>{null}</ReaderChatRail>
      </div>
    </div>
  );
}
