// /wiki/<slug> — SEO landing for a specific public wiki entry.
//
// SSR fetches /api/v1/wiki/:slug; a 404 falls through to RestrictedDoc. <head> gets
// og:title / description / canonical so crawlers get full metadata. owner handle uses
// the sole owner (v1 single-owner instance).
//
// Layout follows design wiki.js: OG cover (21:9 hue hero) -> breadcrumb (<- writing) ->
// metadata strip (date · by + serif h1 + italic excerpt) -> article-body
// (editorial-grade reading typography, via ChatMarkdown variant="article") -> about box.
// The ask composer (AskAboutThis + FloatingChatDock) stays **as-is** per owner's request.

import type { Metadata } from 'next';

import { WikiReaderClient } from '@/components/visitor/WikiReaderClient';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiContext, fetchWikiLanding } from '@/lib/api/public';
import { parseWikiLanding } from '@/lib/visitor/wiki-landing';

// catch-all [...path]: path can contain `/` (grouping like projects/lucerna).
type Params = { path: string[] };
// Search — `?lang=zh`. The server picks the right side of a multilingual note upfront:
// crawlers and agents get real content, not a skeleton waiting on JS.
type Search = { lang?: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { path } = await params;
  const wiki = await fetchWikiLanding(path.join('/'));
  return wiki ? {
    title: wiki.title,
    description: wiki.excerpt || wiki.body.slice(0, 160),
    openGraph: { title: wiki.title, description: wiki.excerpt, type: 'article' },
  } : { title: 'not found' };
}

// wantedLang — `?lang=`; if absent, use this note's identity language (backend decides).
function wantedLang(search: Search): string {
  return search.lang ?? '';
}

export default async function WikiLandingPage(
  { params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> },
) {
  const { path } = await params;
  const slug = path.join('/');
  const want = wantedLang(await searchParams);
  // SSR fetches anonymously (published-only, for crawlers/SEO). WikiReaderClient re-fetches WITH the
  // stored visitor token when this comes back null, so an invited viewer reads in-scope gated entries
  // (F-L-11 bearer-aware reader) while published entries keep their fast SSR path.
  // The tree and top bar fetch their own data in `wiki/layout.tsx` — this page no longer
  // needs stats.
  const [wiki, instance, ctx] = await Promise.all([
    fetchWikiLanding(slug, want), fetchInstance(), fetchWikiContext(slug),
  ]);
  return (
    <WikiReaderClient
      // parseWikiLanding — the **same** parser used by the token-bearing refetch path.
      // Previously the raw payload was passed straight through, and the reader-side type
      // happened to be loose enough to accept it, so a published note's hero image / hero
      // line / inline body images never reached the page at all, with no error anywhere
      // (F-L-33).
      initialWiki={parseWikiLanding(wiki)}
      handle={instance.handle}
      ownerName={instance.name || instance.handle}
      slug={slug}
      initialCtx={ctx}
      lang={want}
    />
  );
}
