// FormSkeleton — form loading state for /admin/page, /admin/api-mcp, the
// owner's-ai panel, etc.
// A label + input placeholder pair repeats N times to approximate the
// form's height.
//
// For a short form (e.g. a single input + button), use InlineSkeleton
// instead.

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
