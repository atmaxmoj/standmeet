// static-html.ts — sanitize for ` ```standmeet-html ` blocks (Obsidian-ecosystem leverage #2).
// On export the owner pre-bakes plugin content (Dataview etc.) into static HTML; only after
// allowlist sanitization here does it render into the body: structural/text tags are kept,
// **script / iframe / style / on* event attributes / javascript: URLs are stripped**.

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
  // Only allow safe schemes; javascript:/data: and the like are stripped
  // (sanitize-html also blocks script/on* by default).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  disallowedTagsMode: 'discard',
};

export function sanitizeStaticHtml(source: string): string {
  return sanitizeHtml(source, OPTIONS);
}
