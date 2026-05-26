// /wiki/<slug> —— SEO landing for a specific public wiki entry。
//
// SSR fetch /api/v1/wiki/:slug；404 走 Next not-found。<head> 加
// og:title / og:description / canonical 让爬虫拿到完整 metadata。owner
// handle 用 sole owner（v1 单 owner instance），URL 不再带 handle。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { SessionStrip } from '@/components/visitor/SessionStrip';
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
    <>
      <SessionStrip />
      <main className="pb-24">
        <article className="mx-auto max-w-2xl px-6 py-16" data-testid="wiki-landing">
          <PageHeader />
          <Breadcrumb slug={path.join('/')} />
          <h1 className="reading-tight text-4xl font-normal mb-6">{wiki.title}</h1>
          <p className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mb-8">
            from {handle}&apos;s corpus · updated {wiki.updated_at.slice(0, 10)}
          </p>
          <WikiBody body={wiki.body} />
          <TrustBox handle={handle} />
        </article>
        <AskAboutThis title={wiki.title} kind="wiki" />
      </main>
    </>
  );
}

function Breadcrumb({ slug }: { slug: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-6 flex items-baseline gap-2 flex-wrap">
      <Link href="/blog" className="hover:text-(--color-ink)">writing</Link>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-ink)">wiki · {slug}</span>
    </div>
  );
}

function TrustBox({ handle }: { handle: string }) {
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5">about this entry</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        One of {handle}&apos;s wiki entries. The AI on this site is grounded in the same
        corpus, so you can ask follow-ups below and get answers in his voice with
        citations back to entries like this one.
      </p>
    </div>
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

