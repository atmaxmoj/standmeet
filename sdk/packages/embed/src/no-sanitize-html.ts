// no-sanitize-html —— stands in for sanitize-html in the embed bundle (tsup alias). sanitize-html
// pulls in postcss, which requires Node's `path`; an IIFE cannot defer that to a lazy chunk, so it
// would throw on load and take the whole chat down on the host page. An owner's pre-baked
// `standmeet-html` block therefore renders as nothing in the embed — the safe direction: never
// unsanitized HTML, only no HTML.
export default function sanitizeHtml(): string {
  return '';
}
