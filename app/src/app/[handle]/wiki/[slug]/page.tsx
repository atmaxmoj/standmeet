// /<handle>/wiki/<slug> —— SEO landing for a specific public wiki entry.
//
// SSR fetch /api/v1/wiki/:handle/:slug；404 走 Next not-found。&lt;head&gt;
// 加 og:title / og:description / canonical 让爬虫拿到完整 metadata。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { fetchWikiLanding } from '@/lib/api/public';

type Params = { handle: string; slug: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { handle, slug } = await params;
  const wiki = await fetchWikiLanding(handle, slug);
  return wiki ? {
    title: `${wiki.title} — ${handle}`,
    description: wiki.seo_description || wiki.body.slice(0, 160),
    openGraph: {
      title: wiki.title,
      description: wiki.seo_description,
      type: 'article',
    },
  } : { title: 'not found' };
}

export default async function WikiLandingPage({ params }: { params: Promise<Params> }) {
  const { handle, slug } = await params;
  const wiki = (await fetchWikiLanding(handle, slug)) ?? notFound();
  return (
    <article className="mx-auto max-w-2xl px-6 py-16" data-testid="wiki-landing">
      <PageHeader handle={handle} />
      <h1 className="reading-tight text-4xl font-normal mb-6">{wiki.title}</h1>
      <p className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mb-8">
        from {handle}&apos;s corpus · updated {wiki.updated_at.slice(0, 10)}
      </p>
      <WikiBody body={wiki.body} />
      <Footer handle={handle} />
    </article>
  );
}

function PageHeader({ handle }: { handle: string }) {
  return (
    <header className="mb-10">
      <Link href={`/${handle}`} className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        ← {handle}
      </Link>
    </header>
  );
}

function WikiBody({ body }: { body: string }) {
  return (
    <div className="reading text-base whitespace-pre-wrap">{body}</div>
  );
}

function Footer({ handle }: { handle: string }) {
  return (
    <footer className="mt-16 pt-6 border-t border-(--color-rule)">
      <Link href={`/${handle}`} className="link mono text-sm">
        chat with {handle}&apos;s AI about this →
      </Link>
    </footer>
  );
}
