// WikiIndexEmpty —— /wiki 的索引列表空着时，正文列自己说明为什么。
//
// 这句话本来住在侧栏（`WikiTreeView` 的 TreeStats 脚注，F-L-11 part B）。而侧栏在 `lg`
// 以下整个隐藏 —— 那是**对的**响应式，桌面版那棵树塞不进 390px。代价是：手机上访客拿到
// 一张纯白页，标题 "The corpus, by entry" 底下什么都没有，没有原因也没有下一步。
// F-L-11 修的正是「一堆数字配一棵空树等于吹牛」，而它在另一个视口上原样回来了。
//
// 所以这句话搬到正文列 —— 它回答的是「我眼前这张列表为什么是空的」，而那张列表在这里。
// 侧栏留下计数（数字是给宽屏的额外信息，不是这个问题的答案）。
//
// 两种空是两回事，不许共用一句：
//   - 有条目、但对匿名访客全是私有的 → 这是**邀约**：去输个码。
//   - 一条都没有 → 这是**还没开始**：说实话，别暗示有什么东西藏着。
// 拿一句去顶另一句，就是在没有 rest 的时候许诺一个 rest。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import type { WikiTreeStats } from '@/lib/api/public';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

// allGatedAnonymous —— 无 session，且 published（= entries − gated）为 0。
// 受邀访客不算：他每一条都打得开，对他说「这些是私有的」是假话（F-L-14）。
export function allGatedAnonymous(hasSession: boolean, stats: WikiTreeStats): boolean {
  return !hasSession && stats.entries > 0 && stats.entries === stats.gated;
}

export function WikiIndexEmpty({ stats, empty }: { stats: WikiTreeStats; empty: boolean }) {
  const session = useVisitorSessionStore((s) => s.session);
  return empty ? <EmptyReason gated={allGatedAnonymous(session !== null, stats)} /> : null;
}

function EmptyReason({ gated }: { gated: boolean }) {
  return gated ? <GatedHint /> : <NothingYet />;
}

// GatedHint —— 有东西，但对这位访客是私有的。这是一句**邀约**，所以它带着去处。
function GatedHint() {
  const t = useTranslations('visitor.wikiTreeView');
  return (
    <div data-testid="wiki-tree-gated-hint" className="mono text-[12px] text-(--color-muted)">
      <Link href="/gate" className="hover:text-(--color-accent) transition-colors">
        {t('gatedHint')} {'→'}
      </Link>
    </div>
  );
}

// NothingYet —— 真的一条都没有。不给去处，因为输码也变不出东西来。
function NothingYet() {
  const t = useTranslations('visitor.wikiTreeView');
  return (
    <div data-testid="wiki-index-empty" className="mono text-[12px] text-(--color-faint)">
      {t('indexEmpty')}
    </div>
  );
}
