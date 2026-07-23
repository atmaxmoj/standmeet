// /wiki/<slug> —— SEO landing for a specific public wiki entry。
//
// SSR fetch /api/v1/wiki/:slug；404 走 RestrictedDoc。<head> 加 og:title /
// description / canonical 让爬虫拿到完整 metadata。owner handle 用 sole owner
// (v1 单 owner instance)。
//
// 版式对齐设计 wiki.js:OG cover(21:9 hue hero)→ breadcrumb(← writing)→
// metadata strip(date · by + serif h1 + italic excerpt)→ article-body
// (编辑级阅读排版,走 ChatMarkdown variant="article")→ about box。
// ask composer(AskAboutThis + FloatingChatDock)按 owner 要求**保留现状**。

import type { Metadata } from 'next';

import { WikiReaderClient } from '@/components/visitor/WikiReaderClient';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiContext, fetchWikiLanding, fetchWikiTreeStats } from '@/lib/api/public';

// catch-all [...path]：path 可含 `/` (projects/lucerna 这种分组)。
type Params = { path: string[] };

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

export default async function WikiLandingPage({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const slug = path.join('/');
  // SSR fetches anonymously (published-only, for crawlers/SEO). WikiReaderClient re-fetches WITH the
  // stored visitor token when this comes back null, so an invited viewer reads in-scope gated entries
  // (F-L-11 bearer-aware reader) while published entries keep their fast SSR path.
  const [wiki, instance, ctx, stats] = await Promise.all([
    fetchWikiLanding(slug), fetchInstance(), fetchWikiContext(slug), fetchWikiTreeStats(),
  ]);
  return (
    <WikiReaderClient
      initialWiki={wiki ?? null}
      handle={instance.handle}
      ownerName={instance.name || instance.handle}
      slug={slug}
      initialCtx={ctx}
      stats={stats}
    />
  );
}
