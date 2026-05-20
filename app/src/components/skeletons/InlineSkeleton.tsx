// InlineSkeleton —— 单条信息占位（label + 一行值）。给 admin sidebar pulse、
// /admin/page handle row 等小尺寸 loading 用，不要全屏 card-grid 那种重的。

import { Skel } from '@/components/skeletons/Skel';

type Props = { width?: string };

export function InlineSkeleton({ width = 'w-32' }: Props) {
  return (
    <span
      aria-busy="true"
      aria-label="loading"
      className="inline-flex items-baseline align-middle"
    >
      <Skel h="h-3" w={width} />
    </span>
  );
}

