// WidgetBlock —— the ` ```standmeet-widget ` sandboxed iframe block
// (rendering-and-extensibility.md §25-28).
//
// The block contains a JSON descriptor (src / height / sandbox, parsed in
// @/lib/render/widget-descriptor). Renders into a **sandboxed <iframe>** —
// widget content is user-provided, so it must be sandbox-isolated
// (isolation-first). **mount-guard**: only mounts client-side (after
// useEffect), so the SSR HTML has no iframe → `seo:false` (not indexed by
// crawlers, design non-negotiable §44). v1: iframe-mount + sandbox +
// descriptor; a postMessage protocol is deferred.

'use client';

import { useEffect, useState } from 'react';

import { parseWidgetDescriptor } from '@/lib/render/widget-descriptor';

export function WidgetBlock({ source }: { source: string }): React.ReactElement | null {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const desc = parseWidgetDescriptor(source);
  return mounted && desc !== null
    ? (
      <iframe
        data-testid="widget-iframe"
        src={desc.src}
        height={desc.height}
        sandbox={desc.sandbox}
        className="w-full border border-(--color-rule) rounded-[3px] my-4"
        title="standmeet widget"
      />
    )
    : null;
}
