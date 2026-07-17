// /output/<slug> —— SEO landing for a polished output entry。
//
// raw → wiki → output 三层中"可在对话里完整原样引用"的成品层。SSR fetch
// /api/v1/output/:slug；404 走 Next not-found。<head> 加 og:title /
// og:description / canonical。

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
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
    description: out.excerpt || out.body.slice(0, 160),
    openGraph: {
      title: out.title,
      description: out.excerpt,
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
  out: { title: string; body: string; excerpt: string; updated_at: string };
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

async function OutputCoverHero({ title, handle, updatedAt }: {
  title: string; handle: string; updatedAt: string;
}) {
  const t = await getTranslations('reader');
  return (
    <div className="border-b border-(--color-rule) bg-(--color-surface)/40 py-16 px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4 flex items-baseline gap-2">
          <span>{t('output.kicker', { handle })}</span>
          <span className="border border-(--color-rule) px-1.5 py-0.5 text-[9px]">{t('output.polished')}</span>
        </div>
        <h1 className="font-serif text-[clamp(36px,5vw,56px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.05] mb-4">
          {title}
        </h1>
        <p className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-2">
          {t('output.updated', { date: updatedAt.slice(0, 10) })}
        </p>
      </div>
    </div>
  );
}

async function PDFPreviewCard() {
  const t = await getTranslations('reader');
  return (
    <div className="border border-(--color-rule) rounded-[3px] bg-(--color-surface)/60 mb-10 aspect-[8.5/11] max-w-[280px] mx-auto flex items-center justify-center">
      <span className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)">{t('output.pdfPreview')}</span>
    </div>
  );
}

async function Breadcrumb({ slug }: { slug: string }) {
  const t = await getTranslations('reader');
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-6 flex items-baseline gap-2 flex-wrap">
      <Link href="/writings" className="hover:text-(--color-ink)">{t('output.writings')}</Link>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-ink)">{t('output.breadcrumbCurrent', { slug })}</span>
    </div>
  );
}

async function TrustBox({ handle }: { handle: string }) {
  const t = await getTranslations('reader');
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5">{t('output.aboutHeading')}</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        {t('output.aboutBody', { handle })}
      </p>
    </div>
  );
}

async function PageHeader() {
  // #39: document 页统一返回 writing index,不再「← home」回 /。
  const t = await getTranslations('reader');
  return (
    <header className="mb-10">
      <Link href="/writings" className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-accent)">
        {t('output.backToWriting')}
      </Link>
    </header>
  );
}

function OutputBody({ body }: { body: string }) {
  return (
    <div className="reading text-base" data-testid="output-body">
      <CorpusContent>
        <ChatMarkdown source={body} />
      </CorpusContent>
    </div>
  );
}

