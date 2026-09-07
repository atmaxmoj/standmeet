// loading.tsx — the shared instant skeleton for EVERY admin section (Q2). admin/layout mounts
// AdminShell (sidebar persists); this is the Suspense fallback for its {children}, so clicking a
// sidebar section flips the URL and shows this skeleton AT ONCE, while the section's RSC + data stream
// in behind it. Without it, Next held the old screen until the payload arrived ("点了好久才变",
// no skeleton). One boundary covers all sections because they all render in the same children slot.

import { Skel } from '@/components/skeletons/Skel';

export default function AdminSectionLoading() {
  return (
    <div data-testid="admin-section-skeleton">
      <div className="mb-6">
        <Skel h="h-2.5" w="w-24" />
        <div className="mt-2"><Skel h="h-7" w="w-56" /></div>
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skel key={i} h="h-14" w="w-full" />)}
      </div>
    </div>
  );
}
