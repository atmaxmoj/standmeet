// CardGridSkeleton —— /admin/codes /admin/raw 那种"卡片网格"loading 占位。
// 每个卡子 = 标题块 + 几行短文本 + QR 占位。N 默认 4 张，撑 above-the-fold。

import { Skel } from '@/components/skeletons/Skel';

type Props = { count?: number };

export function CardGridSkeleton({ count = 4 }: Props) {
  return (
    <ul
      aria-busy="true"
      aria-label="loading"
      className="grid grid-cols-1 xl:grid-cols-2 gap-5"
    >
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <CardSkel />
        </li>
      ))}
    </ul>
  );
}

function CardSkel() {
  return (
    <article className="border border-(--color-rule) bg-(--color-surface)/30 p-5 rounded-sm">
      <div className="flex items-baseline justify-between mb-4 gap-3">
        <Skel h="h-5" w="w-2/5" />
        <Skel h="h-3" w="w-16" />
      </div>
      <div className="flex gap-5">
        <div className="flex-1 space-y-2">
          <Skel h="h-3" w="w-5/6" />
          <Skel h="h-3" w="w-3/4" />
          <Skel h="h-3" w="w-2/3" />
        </div>
        <Skel h="h-20" w="w-20" />
      </div>
      <div className="mt-5 pt-3 border-t border-(--color-rule)/60">
        <Skel h="h-2.5" w="w-1/2" />
      </div>
    </article>
  );
}
