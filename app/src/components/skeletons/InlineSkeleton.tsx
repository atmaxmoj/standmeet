// InlineSkeleton — a single-field placeholder (label + one line of value).
// Use it for small loading states like the admin sidebar pulse or the
// /admin/page handle row — not the heavier full-screen card-grid style.

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

