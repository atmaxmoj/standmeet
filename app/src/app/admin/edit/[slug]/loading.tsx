// loading.tsx — the editor route's instant skeleton. Clicking a page's name in the microsites list
// used to feel like nothing happened: with no loading boundary, Next held the old screen until the
// editor segment's RSC payload arrived, so the URL and the page only changed "过了很久" later
// (owner). A loading.tsx makes the navigation land immediately — the URL flips and this skeleton
// shows at once, in the editor's own two-column shape, while PageEditor streams in behind it.

import { Skel } from '@/components/skeletons/Skel';

export default function EditMicrositeLoading() {
  return (
    <div data-testid="editor-loading">
      <div className="mb-4">
        <Skel h="h-2.5" w="w-24" />
        <div className="mt-2"><Skel h="h-6" w="w-64" /></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="min-w-0">
          <Skel h="h-8" w="w-40" />
          <div className="mt-1 border border-(--color-rule) rounded-[3px] p-3">
            <Skel h="h-[400px]" w="w-full" />
          </div>
        </div>
        <div className="lg:sticky lg:top-4">
          <Skel h="h-[480px]" w="w-full" />
        </div>
      </div>
    </div>
  );
}
