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

// TextLinesSkeleton —— 几行 prose 占位（intro 文案 / loading body 等）。
export function TextLinesSkeleton({ lines = 3 }: { lines?: number }) {
  const widths = ['w-full', 'w-11/12', 'w-3/4', 'w-5/6', 'w-2/3'];
  return (
    <div aria-busy="true" aria-label="loading" className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <Skel key={i} h="h-3" w={widths[i % widths.length]} />
      ))}
    </div>
  );
}
