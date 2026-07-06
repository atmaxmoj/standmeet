// WidgetBlock —— ` ```standmeet-widget ` 沙箱 iframe 块(rendering-and-extensibility.md §25-28)。
//
// 块内是 JSON descriptor(src / height / sandbox,解析在 @/lib/render/widget-descriptor)。渲染成
// **sandboxed <iframe>** —— widget 内容 user-provided,必须 sandbox 隔离(isolation-first)。
// **mount-guard**:只在客户端挂(useEffect 后),SSR HTML 里没 iframe → `seo:false`(不被爬虫
// 索引,design 非-negotiable §44)。v1:iframe-mount + sandbox + descriptor;postMessage 协议后置。

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
