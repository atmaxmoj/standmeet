// /output/<slug> —— SEO landing for a polished output entry。
//
// raw → wiki → output 三层中"可在对话里完整原样引用"的成品层。SSR fetch
// /api/v1/output/:slug；404 走 Next not-found。<head> 加 og:title /
// og:description / canonical。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { fetchInstance } from '@/lib/api/instance';
import { fetchOutputLanding } from '@/lib/api/public';

// catch-all [...path]：path 可含 `/` 分组分段。
type Params = { path: string[] };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { path } = await params;
  const out = await fetchOutputLanding(path.join('/'));
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
  const { path } = await params;
  const out = (await fetchOutputLanding(path.join('/'))) ?? notFound();
  const instance = await fetchInstance();
  const handle = instance.handle;
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        <article className="mx-auto max-w-2xl px-6 py-16" data-testid="output-landing">
          <PageHeader />
          <Breadcrumb slug={path.join('/')} />
          <h1 className="reading-tight text-4xl font-normal mb-6">{out.title}</h1>
          <p className="mono text-[10px] tracking-[0.12em] text-(--color-muted) mb-8">
            from {handle}&apos;s corpus · polished output · updated {out.updated_at.slice(0, 10)}
          </p>
          <OutputBody body={out.body} />
          <TrustBox handle={handle} />
        </article>
        <AskAboutThis title={out.title} kind="output" />
      </main>
    </>
  );
}

function Breadcrumb({ slug }: { slug: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-6 flex items-baseline gap-2 flex-wrap">
      <Link href="/blog" className="hover:text-(--color-ink)">writing</Link>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-ink)">output · {slug}</span>
    </div>
  );
}

function TrustBox({ handle }: { handle: string }) {
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5">about this piece</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        Polished output from {handle}&apos;s corpus — wiki entries promoted to a
        public-facing draft. The AI uses the same corpus, so follow-ups below
        will quote this and related entries directly.
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

function OutputBody({ body }: { body: string }) {
  return <div className="reading text-base whitespace-pre-wrap">{body}</div>;
}

