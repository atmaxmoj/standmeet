// /output/<slug> —— SEO landing for a polished output entry。
//
// raw → wiki → output 三层中"可在对话里完整原样引用"的成品层。SSR fetch
// /api/v1/output/:slug；404 走 Next not-found。<head> 加 og:title /
// og:description / canonical。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { fetchInstance } from '@/lib/api/instance';
import { fetchOutputLanding } from '@/lib/api/public';

type Params = { slug: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { slug } = await params;
  const out = await fetchOutputLanding(slug);
  return out ? {
    title: out.title,
    description: out.seo_description || out.body.slice(0, 160),
    openGraph: {
      title: out.title,
      description: out.seo_description,
      type: 'article',
    },
  } : { title: 'not found' };
}

export default async function OutputLandingPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const out = (await fetchOutputLanding(slug)) ?? notFound();
  const instance = await fetchInstance();
  const handle = instance.handle;
  return (
    <article className="mx-auto max-w-2xl px-6 py-16" data-testid="output-landing">
      <PageHeader />
      <h1 className="reading-tight text-4xl font-normal mb-6">{out.title}</h1>
      <p className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mb-8">
        from {handle}&apos;s corpus · polished output · updated {out.updated_at.slice(0, 10)}
      </p>
      <OutputBody body={out.body} />
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

function OutputBody({ body }: { body: string }) {
  return <div className="reading text-base whitespace-pre-wrap">{body}</div>;
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
