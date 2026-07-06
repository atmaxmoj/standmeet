// StaticHtmlBlock —— ` ```standmeet-html ` 块:owner 预烤的静态 HTML,sanitize 后渲进正文
// (Obsidian-ecosystem leverage #2,pre-render-at-export)。内容是 static,进 .corpus-content
// 后 owner CSS 照样命中。sanitize 在 @/lib/render/static-html(剥 script/iframe/on*/js-url)。

'use client';

import { sanitizeStaticHtml } from '@/lib/render/static-html';

export function StaticHtmlBlock({ source }: { source: string }): React.ReactElement {
  return <div data-testid="static-html" dangerouslySetInnerHTML={{ __html: sanitizeStaticHtml(source) }} />;
}
