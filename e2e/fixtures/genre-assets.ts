// genre-assets.ts —— shared helpers for attaching assets to every genre.
//
// Assets are hosted elsewhere (external-mock's /media/*), and the backend fetches
// them by https address —— just like the owner's real usage: the image is on an
// image host / cloud drive, and he gives the AI a link.

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

// MEDIA —— a few addresses served by the asset host. The bad ones are
// **intentionally wrong**, for the fetch-step guards.
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// The image host is https —— the backend's asset-fetch step only accepts https,
// so the mock has to really speak https (see mock-stack/job-board/tls.go:9443 is
// its https face, 9000 is still plaintext).
const MEDIA_BASE = 'https://external-mock:9443/media';
export const MEDIA = {
  // The ones to accept —— "multimedia" isn't only png.
  pixel: `${MEDIA_BASE}/pixel.png`,
  gif: `${MEDIA_BASE}/anim.gif`,
  webp: `${MEDIA_BASE}/shot.webp`,
  mp4: `${MEDIA_BASE}/clip.mp4`,
  pdf: `${MEDIA_BASE}/paper.pdf`,
  // The ones to reject —— each corresponds to a specific bypass, see
  // mock-stack/job-board/media.go.
  svg: `${MEDIA_BASE}/vector.svg`,
  lying: `${MEDIA_BASE}/lying.png`,
  html: `${MEDIA_BASE}/page.html`,
  notImage: `${MEDIA_BASE}/not-an-image.txt`,
  missing: `${MEDIA_BASE}/missing.png`,
  insecure: 'http://external-mock:9000/media/pixel.png', // not https
  // uaRequired —— a host that **requires a descriptive User-Agent**. Wikimedia is
  // one: it 403s an HTTP library's default UA outright, and "paste an image from
  // Wikipedia" is one of the most common things an owner does.
  uaRequired: `${MEDIA_BASE}/ua-required.png`,
} as const;

/** bulk —— serve a given number of MB of bytes of a given type. The cap is
 *  per-kind, so the same size must be usable as two kinds. */
export function bulk(mb: number, type: string): string {
  return `${MEDIA_BASE}/bulk?mb=${mb}&type=${encodeURIComponent(type)}`;
}

/** One asset on a corpus entry (the shape returned after upload). */
export interface UploadedAsset {
  asset_id: string;
  content_type: string;
  size_bytes: number;
  original_filename: string;
}

/** One asset attached to a corpus entry, as read back (these are the fields the
 *  download button needs). */
interface EntryAsset {
  asset_id: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  original_filename: string;
  url: string;
}

/** The asset-related fields of a corpus entry when read back. */
export interface EntryAssets {
  id: string;
  genre: string;
  path?: string;
  body?: string;
  cover_image_asset_id?: string | null;
  cover_headline?: string;
  cover_hue?: string;
  title?: string;
  asset_urls?: Record<string, string>;
  assets?: EntryAsset[];
}

interface MCPSession { request: APIRequestContext; token: string; sid: string }

/**
 * Create a corpus entry of a given genre, returning its id.
 *
 * subjectivity has **a different write path** (subjectivity_write: that's the
 * self-model the owner writes with his own AI, not via corpus.create). Read,
 * delete, and asset-attach share the one path —— so this branches here, and the
 * caller need not know.
 */
export async function createEntry(
  s: MCPSession, genre: string, title: string, body: string,
): Promise<string> {
  if (genre === 'subjectivity') {
    // The response key is subjectivity_id, not id —— that op's name and shape are
    // what the owner's AI has always used, so the outward-facing naming wasn't
    // changed in the move.
    const made = await callTool<{ subjectivity_id: string }>(
      s.request, s.token, s.sid, 'subjectivity_write', { title, body },
    );
    return made.subjectivity_id;
  }
  const item = await callTool<{ id: string }>(s.request, s.token, s.sid, 'corpus.create', {
    genre, title, body,
  });
  return item.id;
}

/** Attach an asset to a corpus entry: the backend fetches it by address. */
export async function uploadAsset(
  s: MCPSession, genre: string, id: string, url: string, opts: UploadOpts = {},
): Promise<UploadedAsset> {
  return callTool<UploadedAsset>(s.request, s.token, s.sid, 'assets.upload', {
    genre, id, url, ...opts,
  });
}

/** kind —— 'image' (inline body image / hero) or 'attachment' (a downloadable
 *  attachment, e.g. a PDF). */
export interface UploadOpts { kind?: string; filename?: string }

/** The hero area: image + the line laid over it + hue. */
export interface HeroPatch {
  cover_image_asset_id?: string;
  cover_headline?: string;
  cover_hue?: string;
}

/** Set the hero area. subjectivity's write path is its own (see createEntry's note). */
export async function setHero(
  s: MCPSession, genre: string, id: string, hero: HeroPatch,
): Promise<unknown> {
  if (genre === 'subjectivity') {
    return editSubjectivity(s, id, hero);
  }
  return callTool<EntryAssets>(s.request, s.token, s.sid, 'corpus.update', {
    genre, id, ...hero,
  });
}

/** Edit a corpus entry's body. Like setHero, subjectivity goes via its own write path. */
export async function setBody(
  s: MCPSession, genre: string, id: string, title: string, body: string,
): Promise<unknown> {
  if (genre === 'subjectivity') {
    return editSubjectivity(s, id, { title, body });
  }
  return callTool(s.request, s.token, s.sid, 'corpus.update', { genre, id, title, body });
}

// editSubjectivity —— subjectivity_write's edit path: pass subjectivity_id.
// **title and body are required** (that op's required fields), so even when
// editing the hero you must carry them along —— read them back first and hand them
// back as-is, otherwise you'd clear the body.
async function editSubjectivity(
  s: MCPSession, id: string, patch: HeroPatch & { title?: string; body?: string },
): Promise<unknown> {
  const cur = await getEntry(s, 'subjectivity', id);
  return callTool(s.request, s.token, s.sid, 'subjectivity_write', {
    subjectivity_id: id,
    title: patch.title ?? cur.title ?? '',
    body: patch.body ?? cur.body ?? '',
    ...heroOnly(patch),
  });
}

function heroOnly(p: HeroPatch): HeroPatch {
  return {
    ...(p.cover_image_asset_id === undefined ? {} : { cover_image_asset_id: p.cover_image_asset_id }),
    ...(p.cover_headline === undefined ? {} : { cover_headline: p.cover_headline }),
    ...(p.cover_hue === undefined ? {} : { cover_hue: p.cover_hue }),
  };
}

/** Read back a corpus entry (with asset fields). */
export async function getEntry(
  s: MCPSession, genre: string, id: string,
): Promise<EntryAssets> {
  return callTool<EntryAssets>(s.request, s.token, s.sid, 'corpus.get', { genre, id });
}

/**
 * Whether an asset is still reachable right now —— really send a GET to its
 * accessible address.
 *
 * An empty address is judged "unreachable" **without sending a request**: an empty
 * string resolves to the site root and returns 200, so the "reachable" conclusion
 * would actually come from a page that has nothing to do with the asset. A
 * non-unique signal can't serve as a receipt.
 */
export async function assetReachable(
  request: APIRequestContext, url: string,
): Promise<boolean> {
  if (!url) return false;
  const res = await request.get(url).catch(() => null);
  return res !== null && res.ok();
}

// There used to be visitorRead / VisitorAsset here —— a direct POST to
// `/api/v1/sessions/{cid}/tools/corpus_read`, counting assets from the response
// JSON.
//
// **A visitor never sends that POST**; the page's JS does. And an asset leak
// happens at the **render layer**: the filename, the thumbnail, the broken-image
// placeholder that won't render —— none of which a "array length 0" assertion over
// JSON can see. Those assertions now run in the browser
// (genre-assets-reader.spec.ts), so these two had no callers left. Keeping them
// around means the next person sees them first, copies them, and that back door
// is alive again.

/** assetByID —— the direct-fetch-by-asset-id path. An asset shouldn't have it ——
 *  having it bypasses the article's ACL. */
export async function assetByID(
  request: APIRequestContext, sessionToken: string, assetID: string,
): Promise<number> {
  const res = await request.get(`${BACKEND_URL}/api/v1/assets/${assetID}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  return res.status();
}
