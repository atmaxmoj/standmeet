// share-card.ts —— what a link previewer (LinkedIn, X, Slack, WeChat) reads off a page, server
// side, without running JavaScript: the site's address, a writing's title and description, and the
// address of each card image (drawn by app/src/app/og). Spec standmeet-og-spec-2026-10-21: every
// writing gets posted to LinkedIn, and a bare card with the site's title is what it got.

import { createHash } from 'node:crypto';
import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { fetchInstance } from '@/lib/api/instance';
import type { WritingView } from '@/lib/api/public';

// siteOrigin —— the site's address as the owner set it (sitemap and canonical tags use the same);
// the address this request came in on when none is set.
export async function siteOrigin(): Promise<string> {
  const set = (await fetchInstance().catch(() => null))?.public_url ?? '';
  if (set !== '') {
    return set.replace(/\/+$/, '');
  }
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = h.get('x-forwarded-proto')?.split(',')[0] ?? 'http';
  return `${proto}://${host}`;
}

// siteCardURL —— the site's card: name, the homepage's line, the address. Not versioned (the
// homepage's line is the backend's to know, and the backend points at this same address), so it
// is cached for a day, not forever.
export const siteCardURL = (origin: string): string => `${origin}/og/site`;

// writingCardURL —— a writing's card. The title is in the address (?v=), so a renamed writing
// gets a new image and an unchanged one keeps its address — and can be cached forever.
export function writingCardURL(origin: string, slug: string, title: string): string {
  const v = createHash('sha256').update(title).digest('hex').slice(0, 12);
  return `${origin}/og/writings/${encodeURIComponent(slug)}?v=${v}`;
}

const MAX_DESCRIPTION = 200;

// describe —— the writing's excerpt, else its first paragraph of prose, as plain text, cut at a
// word near 200 characters and marked with "…".
export function describe(excerpt: string, bodyMD: string): string {
  const text = (excerpt.trim() || firstParagraph(bodyMD)).replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_DESCRIPTION) {
    return text;
  }
  const cut = text.slice(0, MAX_DESCRIPTION);
  const at = cut.lastIndexOf(' ');
  return `${(at > 0 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

// firstParagraph —— the first block that is prose: headings, images, quotes, fences, lists and
// tables are skipped; links keep their text; emphasis and code marks go.
function firstParagraph(md: string): string {
  const prose = md.split(/\n\s*\n/).map((b) => b.trim())
    .find((b) => b !== '' && !/^(#|!\[|>|```|~~~|[-*+] |\d+\. |\||<)/.test(b));
  return (prose ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '');
}

// writingMetadata —— a writing's <head>: its English title (the share audience reads English), its
// description, its address and its own card.
export function writingMetadata(w: WritingView, origin: string): Metadata {
  const description = describe(w.excerpt, w.body_md);
  const image = writingCardURL(origin, w.slug, w.title);
  const desc = description === '' ? {} : { description };
  return {
    title: w.title,
    ...desc,
    openGraph: {
      type: 'article', title: w.title, ...desc, url: `${origin}/writings/${w.slug}`,
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title: w.title, ...desc, images: [image] },
  };
}
