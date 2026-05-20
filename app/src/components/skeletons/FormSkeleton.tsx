// FormSkeleton —— /admin/page /admin/api-mcp owner's-ai panel 等表单 loading。
// 一组 label + input 占位重复 N 次，撑出表单大致高度。
//
// 如果具体表单比较短（如 single input + button），用 InlineSkeleton。

import { Skel } from '@/components/skeletons/Skel';

type Props = { rows?: number };

export function FormSkeleton({ rows = 5 }: Props) {
  return (
    <div aria-busy="true" aria-label="loading" className="space-y-7">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skel h="h-2.5" w="w-1/4" />
          <Skel h="h-9" w="w-full" />
        </div>
      ))}
    </div>
  );
}
