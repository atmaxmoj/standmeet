// ListPane —— admin 里「一份列表」的三种结局：还在拉 / 没拉到 / 拉到了（可能是空的）。
//
// **为什么它必须是一个组件，而不是一条纪律**（F-N-7）。
//
// 每个 section 原本自己写 `hook.list.length === 0 ? <空态/> : <列表/>`。这句话漏掉了第三种
// 结局：拉失败之后列表也是空数组，于是**失败穿上空态的衣服**。prod 上真驱出来的样子是
// `/admin/roles` 印着「No roles yet — public is normally seeded on owner claim.」，而那台实例
// 有三个角色；`/admin/ip-bans` 那句更狠 ——「No IPs banned. The public surface is open」。
//
// 空态说的是**一句关于世界的话**，而且它总是指向一个动作（`+ NEW ROLE`）。失败时说它，
// owner 会在一份自己没读到的配置上面动手。
//
// 产品里**已经有人做对过**（`CodeCorpusConfig` 的 `CorpusLoadFailed`、`CapabilitiesPanel` 判
// `status === 'error'`）—— 做对的方式是**手写第三种状态**。而手写就意味着下一个 section 还会漏：
// 需要人记得的检查就是一个职责类（[[structure-means-no-responsibility-class]]）。所以这里把
// 顺序**焊死在一个地方**：error 排在 `count === 0` 前面，空态在结构上不可能从失败里长出来
// （[[reframes-tasks-into-enforced-invariants]]）。
//
// 配套闸门 `check-one-empty-state.sh`：admin section 里不许再出现手写的
// 「`length === 0` → 空态」。

'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import type { ResourceStatus } from '@/lib/state/status';

// isPending —— 还没拉到过。`idle` 也算：ensureLoaded 还没触发，屏幕上不该有任何结论。
function isPending(status: ResourceStatus): boolean {
  return status === 'idle' || status === 'loading';
}

export function ListPane({ status, count, empty, skeleton, children }: {
  status: ResourceStatus;
  // count —— 拉到的条数。**不是** children 的长度：空态由数据决定，不由渲染决定。
  count: number;
  empty: ReactNode;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  return isPending(status)
    ? (skeleton ?? <CardGridSkeleton />)
    : <LoadedPane status={status} count={count} empty={empty}>{children}</LoadedPane>;
}

// LoadedPane —— 拉完之后的两种结局。**这三行的顺序就是这个组件存在的理由**，别调。
function LoadedPane({ status, count, empty, children }: {
  status: ResourceStatus;
  count: number;
  empty: ReactNode;
  children: ReactNode;
}) {
  return status === 'error'
    ? <SectionLoadFailed />
    : count === 0 ? empty : children;
}

// SectionLoadFailed —— 一句话，一处。措辞要**点破那个误读**：owner 眼前少了一块东西时，
// 默认的解读是「那就是没有」，所以这句话得直接说「这不是『没有』，是『不知道』」。
// 不许出现 HTTP 动词 / 状态码 / 内部路径（`admin-load-failure-not-empty` 里那条守卫钉着）。
function SectionLoadFailed() {
  const t = useTranslations('adminShell.listPane');
  return (
    <p
      data-testid="section-load-failed"
      className="reading italic text-(--color-accent)"
    >
      {t('loadFailed')}
    </p>
  );
}
