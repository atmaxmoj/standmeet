// StaticHtmlBlock —— the ` ```standmeet-html ` block: owner-prebaked static
// HTML, sanitized then rendered into the body (Obsidian-ecosystem leverage
// #2, pre-render-at-export). The content is static, and once it's inside
// .corpus-content owner CSS still hits it. Sanitizing happens in
// @/lib/render/static-html (strips script/iframe/on*/js-url).

'use client';

import { sanitizeStaticHtml } from '@/lib/render/static-html';

export function StaticHtmlBlock({ source }: { source: string }): React.ReactElement {
  return <div data-testid="static-html" dangerouslySetInnerHTML={{ __html: sanitizeStaticHtml(source) }} />;
}
