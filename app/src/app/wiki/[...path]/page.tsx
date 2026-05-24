// /wiki/<slug> —— SEO landing for a specific public wiki entry。
//
// SSR fetch /api/v1/wiki/:slug；404 走 Next not-found。<head> 加
// og:title / og:description / canonical 让爬虫拿到完整 metadata。owner
// handle 用 sole owner（v1 单 owner instance），URL 不再带 handle。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiLanding } from '@/lib/api/public';

// catch-all [...path]：path 可含 `/` (projects/lucerna 这种分组)；Next 把
// 路径段交给我们组合成 backend lookup key。
type Params = { path: string[] };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { path } = await params;
  const wiki = await fetchWikiLanding(path.join('/'));
  return wiki ? {
    title: wiki.title,
    description: wiki.seo_description || wiki.body.slice(0, 160),
    openGraph: {
      title: wiki.title,
      description: wiki.seo_description,
      type: 'article',
    },
  } : { title: 'not found' };
}

export default async function WikiLandingPage({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const wiki = (await fetchWikiLanding(path.join('/'))) ?? notFound();
  const instance = await fetchInstance();
  const handle = instance.handle;
  return (
    <article className="mx-auto max-w-2xl px-6 py-16" data-testid="wiki-landing">
      <PageHeader />
      <h1 className="reading-tight text-4xl font-normal mb-6">{wiki.title}</h1>
      <p className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mb-8">
        from {handle}&apos;s corpus · updated {wiki.updated_at.slice(0, 10)}
      </p>
      <WikiBody body={wiki.body} />
      <PageFooter handle={handle} />
    </article>
  );
}

function PageHeader() {
  return (
    <header className="mb-10">
      <Link href="/" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        ← home
      </Link>
    </header>
  );
}

function WikiBody({ body }: { body: string }) {
  return (
    <div className="reading text-base whitespace-pre-wrap">{body}</div>
  );
}

function PageFooter({ handle }: { handle: string }) {
  return (
    <footer className="mt-16 pt-6 border-t border-(--color-rule)">
      <Link href="/" className="link mono text-sm">
        chat with {handle}&apos;s AI about this →
      </Link>
    </footer>
  );
}
