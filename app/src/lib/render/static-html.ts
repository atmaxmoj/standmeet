// static-html.ts —— ` ```standmeet-html ` 块的 sanitize(Obsidian-ecosystem leverage #2)。
// owner 在导出侧把插件内容(Dataview 等)预烤成静态 HTML;这里 allowlist 净化后才渲进正文:
// 留结构/文本标签,**剥 script / iframe / style / on* 事件属性 / javascript: URL**。

import sanitizeHtml from 'sanitize-html';

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'div', 'span', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'a', 'img',
  ],
  allowedAttributes: {
    '*': ['class', 'id'],
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
  },
  // 只放安全 scheme;javascript:/data: 之类被剥(sanitize-html 默认也不放 script/on*)。
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  disallowedTagsMode: 'discard',
};

export function sanitizeStaticHtml(source: string): string {
  return sanitizeHtml(source, OPTIONS);
}
