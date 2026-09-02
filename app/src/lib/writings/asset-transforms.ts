// asset-transforms.ts —— converts between asset URIs and presigned URLs
// inside body_md, in both directions.
//
// The editor's internal doc uses presigned URLs (Tiptap Image node src,
// which the browser can render directly). Server / DB / on-disk markdown
// uses the stable URI `standmeet-asset:<id>` (immune to TTL expiry +
// orphans stay traceable).
//
// On load, expand (URI → URL); on emit/save, contract (URL → URI).
// A freshly uploaded image already arrives in URL form (the upload
// endpoint returns a presigned URL directly), so expand only handles
// body_md coming from the server; contract handles both the
// server-loaded case and the newly-uploaded case.

import { ASSET_URI_SCHEME } from '@/lib/writings/upload-asset';

const URI_RE = new RegExp(ASSET_URI_SCHEME + '([0-9a-fA-F-]{36})', 'g');

// expandURIsToURLs —— body_md → display markdown (URI replaced with
// presigned URL). If urlMap is missing an ID, the original URI is kept —
// the editor renders a broken img but doesn't drop the reference (it
// saves back unchanged). **This is the editor's policy**: the owner is
// editing a draft, and silently dropping the reference would be the
// actual harm.
export function expandURIsToURLs(md: string, urlMap: Record<string, string>): string {
  return md.replace(URI_RE, (match, id: string) => urlMap[id] ?? match);
}

// IMAGE_WITH_URI_RE —— the whole image node `![alt](standmeet-asset:<id>)`,
// including its alt text.
const IMAGE_WITH_URI_RE = new RegExp(
  '!\\[[^\\]]*\\]\\(\\s*' + ASSET_URI_SCHEME + '([0-9a-fA-F-]{36})\\s*\\)', 'g',
);

// expandURIsForReader —— the policy for **the visitor side**: expand
// when it resolves, and **drop the whole image node** when it doesn't.
//
// The same function can't serve both readers (F-L-50): the editor must
// keep the reference (the owner is still editing), while the visitor
// shouldn't see a broken image. Both sides used to share
// `expandURIsToURLs`, so after an asset got removed, the public page
// left a browser-default broken-image placeholder in the middle of the
// body, with the original filename `harness-photo.jpg` still printed in
// the alt text — react-markdown strips a non-standard scheme like
// `standmeet-asset:` down to an empty src.
//
// Dropping the whole node instead of just the URI: dropping only the
// address would leave `![original-filename]()`, exposing the
// **internal filename** to the visitor — worse than a broken image.
export function expandURIsForReader(md: string, urlMap: Record<string, string>): string {
  const withoutDangling = md.replace(IMAGE_WITH_URI_RE, (match, id: string) =>
    (urlMap[id] === undefined ? '' : match));
  return expandURIsToURLs(withoutDangling, urlMap);
}

// contractURLsToURIs —— display markdown → body_md (presigned URL
// replaced back with URI). inverseMap is url → id; only matches the
// image-reference `(url)` shape, to avoid hitting a plain link.
export function contractURLsToURIs(md: string, inverseMap: Record<string, string>): string {
  return Object.keys(inverseMap).length === 0
    ? md
    : Object.entries(inverseMap).reduce(
      (acc, [url, id]) => acc.split('(' + url + ')').join('(' + ASSET_URI_SCHEME + id + ')'),
      md,
    );
}

// invertMap —— inverts urlMap (id→url) into (url→id). Used by contract.
export function invertMap(urlMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(urlMap)) {
    out[url] = id;
  }
  return out;
}
