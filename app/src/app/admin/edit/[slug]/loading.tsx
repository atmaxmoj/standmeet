// loading.tsx — the microsite editor's instant skeleton. Clicking a page in the list used to feel
// like nothing happened (no loading boundary → Next held the old screen until the editor RSC
// arrived); this lands the navigation immediately in the editor's own shape while PageEditor streams
// in behind it. It mirrors PageEditor's real structure — header, view toggle, then a two-column grid
// of (file tabs → code lines → actions → widgets) and the preview — at a fine granularity, so it
// reads as "the editor, loading", not one big grey slab (owner: "整页 skeleton 不太对，粒度太大了").

import { Skel } from '@/components/skeletons/Skel';

// Varying widths so the code area reads as lines of code, not a filled block.
const CODE_LINES = ['w-2/5', 'w-4/5', 'w-3/5', 'w-11/12', 'w-1/2', 'w-5/6', 'w-2/3', 'w-3/4', 'w-1/3', 'w-4/5'];
const WIDGET_CHIPS = ['w-24', 'w-20', 'w-28', 'w-16', 'w-24'];

export default function EditMicrositeLoading() {
  return (
    <div data-testid="editor-loading">
      {/* header: back link + the page's name */}
      <div className="mb-4">
        <Skel h="h-2.5" w="w-20" />
        <div className="mt-2"><Skel h="h-6" w="w-56" /></div>
      </div>
      {/* view toggle (code / split / render) */}
      <div className="mb-2 flex gap-1.5">
        <Skel h="h-7" w="w-16" /><Skel h="h-7" w="w-16" /><Skel h="h-7" w="w-16" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {/* code column: file tabs → editor lines → actions → widget palette */}
        <div className="min-w-0">
          <div className="flex gap-1.5 mb-1">
            <Skel h="h-6" w="w-24" /><Skel h="h-6" w="w-20" /><Skel h="h-6" w="w-16" />
          </div>
          <div className="border border-(--color-rule) rounded-[3px] p-3 flex flex-col gap-2">
            {CODE_LINES.map((w, i) => <Skel key={i} h="h-3" w={w} />)}
          </div>
          <div className="mt-2 flex gap-2">
            <Skel h="h-8" w="w-24" /><Skel h="h-8" w="w-20" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {WIDGET_CHIPS.map((w, i) => <Skel key={i} h="h-6" w={w} round="full" />)}
          </div>
        </div>
        {/* render column: preview toolbar + frame */}
        <div className="lg:sticky lg:top-4">
          <Skel h="h-7" w="w-full" />
          <div className="mt-1"><Skel h="h-[440px]" w="w-full" /></div>
        </div>
      </div>
    </div>
  );
}
