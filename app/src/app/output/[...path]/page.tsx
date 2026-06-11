// /output/<slug> —— SEO landing for a polished output entry。
//
// raw → wiki → output 三层中"可在对话里完整原样引用"的成品层。SSR fetch
// /api/v1/output/:slug；404 走 Next not-found。<head> 加 og:title /
// og:description / canonical。

import type { Metadata } from 'next';
import Link from 'next/link';

import { ChatMarkdown } from '@/components/page/markdown';
import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
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
  const out = await fetchOutputLanding(path.join('/'));
  const instance = await fetchInstance();
  const handle = instance.handle;
  return out
    ? <OutputLandingContent out={out} handle={handle} slug={path.join('/')} />
    : <RestrictedDoc genre="output" slug={path.join('/')} />;
}

function OutputLandingContent({ out, handle, slug }: {
  out: { title: string; body: string; seo_description: string; updated_at: string };
  handle: string;
  slug: string;
}) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        <OutputCoverHero title={out.title} handle={handle} updatedAt={out.updated_at} />
        <article className="mx-auto max-w-2xl px-6 py-16" data-testid="output-landing">
          <PageHeader />
          <Breadcrumb slug={slug} />
          <PDFPreviewCard />
          <OutputBody body={out.body} />
          <TrustBox handle={handle} />
        </article>
        <AskAboutThis title={out.title} kind="output" />
      </main>
      <FloatingChatDock docContext={{ title: out.title, path: slug, genre: 'output' }} />
    </>
  );
}

function OutputCoverHero({ title, handle, updatedAt }: {
  title: string; handle: string; updatedAt: string;
}) {
  return (
    <div className="border-b border-(--color-rule) bg-(--color-surface)/40 py-16 px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4 flex items-baseline gap-2">
          <span>output · from {handle}&apos;s corpus</span>
          <span className="border border-(--color-rule) px-1.5 py-0.5 text-[9px]">polished</span>
        </div>
        <h1 className="font-serif text-[clamp(36px,5vw,56px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.05] mb-4">
          {title}
        </h1>
        <p className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-2">
          updated {updatedAt.slice(0, 10)}
        </p>
      </div>
    </div>
  );
}

function PDFPreviewCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] bg-(--color-surface)/60 mb-10 aspect-[8.5/11] max-w-[280px] mx-auto flex items-center justify-center">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)">PDF preview</span>
    </div>
  );
}

function Breadcrumb({ slug }: { slug: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-6 flex items-baseline gap-2 flex-wrap">
      <Link href="/writings" className="hover:text-(--color-ink)">writings</Link>
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
  // #39: document 页统一返回 writing index,不再「← home」回 /。
  return (
    <header className="mb-10">
      <Link href="/writings" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        ← writing
      </Link>
    </header>
  );
}

function OutputBody({ body }: { body: string }) {
  return (
    <div className="reading text-base" data-testid="output-body">
      <ChatMarkdown source={body} />
    </div>
  );
}

