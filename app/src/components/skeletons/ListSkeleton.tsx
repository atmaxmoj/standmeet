// ListSkeleton — the "row-based list" loading state used by
// /admin/conversations and /admin/requests.
// Each row: dot (status) + title (visitor name) + subtext (time/code) +
// trailing meta.

import { Skel } from '@/components/skeletons/Skel';

type Props = { count?: number };

export function ListSkeleton({ count = 5 }: Props) {
  return (
    <ul aria-busy="true" aria-label="loading">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="grid grid-cols-[180px_1fr_auto_auto_auto] gap-6 py-3 px-1 border-b border-(--color-rule)/60 items-baseline"
        >
          <Skel h="h-3.5" w="w-32" />
          <div className="space-y-1.5">
            <Skel h="h-3" w="w-3/4" />
            <Skel h="h-2.5" w="w-1/3" />
          </div>
          <Skel h="h-3" w="w-12" />
          <Skel h="h-3" w="w-10" />
          <Skel h="h-3" w="w-6" />
        </li>
      ))}
    </ul>
  );
}
