// media.ts —— two pure computations on corpus assets, done before rendering.
//
// **This file has no 'use client'**, so a Server Component can call it too.
// The output landing page is server-rendered; these two functions used to live
// in CorpusMedia.tsx (a client component), and every call from the output page
// 500'd: "Attempted to call coverURL() from the server but coverURL is on the
// client". The wiki path is a client component, so it worked fine there —
// an error that only blows up on one of the two paths is invisible if you
// only look at wiki being green.
//
// The rule is simple: **pure functions don't belong inside a client boundary.**
// They have no state, no hooks, no DOM. Landing in a 'use client' file only
// happened because "the component that uses them is there" — and that's not a reason.

import { expandURIsForReader } from '@/lib/writings/asset-transforms';

/** CorpusAsset —— a file attached to a corpus item, the fields a visitor sees. */
export interface CorpusAsset {
  asset_id: string;
  kind: string;
  original_filename: string;
  url: string;
  size_bytes: number;
}

/**
 * expandBody —— asset URIs in the body → reachable URLs.
 *
 * **This step must run before rendering**: react-markdown's urlTransform strips
 * a non-standard scheme like `standmeet-asset:` outright — the image slot ends
 * up empty, silently, so skipping this is invisible until someone notices.
 */
export function expandBody(body: string, assetURLs?: Readonly<Record<string, string>>): string {
  // Uses the reader's policy: a reference that can't be resolved gets its
  // **whole image node removed** rather than exposing a broken image and the
  // internal filename to the visitor (F-L-50). The editor side still uses
  // expandURIsToURLs — it must preserve the reference.
  return expandURIsForReader(body, { ...(assetURLs ?? {}) });
}

/**
 * coverURL —— the reachable URL for the cover asset. Owner didn't set one, or
 * the URL can't be resolved → undefined, and the caller falls back to its own
 * procedurally generated cover.
 */
export function coverURL(
  coverAssetID?: string, assetURLs?: Readonly<Record<string, string>>,
): string | undefined {
  return coverAssetID ? assetURLs?.[coverAssetID] : undefined;
}
