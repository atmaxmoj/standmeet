// /output/<slug> —— SEO landing for a polished output entry。
//
// raw → wiki → output 三层中"可在对话里完整原样引用"的成品层。SSR fetch
// /api/v1/output/:slug；404 走 Next not-found。<head> 加 og:title /
// og:description / canonical。

import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { OutputLandingView } from '@standmeet/sdk-core';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
import { Attachments, CoverImage } from '@/components/visitor/CorpusMedia';
import { coverURL, expandBody } from '@/lib/corpus/media';
import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { ReaderAboutCard } from '@/components/visitor/ReaderAboutCard';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { fetchInstance } from '@/lib/api/instance';
import { fetchOutputLanding } from '@/lib/api/public';

import styles from '@/app/output/[...path]/output-hero.module.css';

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
  out: OutputLandingView;
  handle: string;
  slug: string;
}) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        <OutputCoverHero
          title={out.title} handle={handle} updatedAt={out.updated_at}
          coverURL={coverURL(out.cover_image_asset_id, out.asset_urls)}
          headline={out.cover_headline ?? ''}
          hue={out.cover_hue ?? ''}
        />
        <article className="mx-auto max-w-2xl px-6 py-16" data-testid="output-landing">
          <PageHeader />
          <Breadcrumb slug={slug} />
          <PDFPreviewCard />
          <OutputBody body={expandBody(out.body, out.asset_urls)} />
          <Attachments assets={out.assets} testid="output-attachments" />
          <ReaderAboutCard genre="output" handle={handle} />
        </article>
        <AskAboutThis title={out.title} kind="output" />
      </main>
      <FloatingChatDock docContext={{ title: out.title, path: slug, genre: 'output' }} />
    </>
  );
}

// OutputCoverHero —— owner 设了封面图就铺那张图,没设就是原来那块底色。
// headline 优先用 owner 写的那句(压在图上的那行),没写才回落到标题。
//
// hero 三件套的第三件(色调)以前在这条路上**没有渲染位**:owner 在编辑器里挑了 acid,
// 后端存了、载荷也发了,而 output 的 hero 一直是一块固定底色(F-L-34)。他没挑就还是那块底色 ——
// 这块 hero 跟 wiki 那块不同,它托着标题和日期,不是"没设就不该存在"的空壳。
async function OutputCoverHero({ title, handle, updatedAt, coverURL: cover, headline, hue }: {
  title: string; handle: string; updatedAt: string;
  coverURL?: string; headline: string; hue: string;
}) {
  const t = await getTranslations('reader');
  return (
    <div
      className={`relative border-b border-(--color-rule) bg-(--color-surface)/40 py-16 px-6 overflow-hidden ${styles['hero']}`}
      data-hue={hue}
      data-testid="output-cover"
    >
      <CoverImage url={cover} testid="output-cover-image" />
      <div className="relative mx-auto max-w-2xl">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4 flex items-baseline gap-2">
          <span>{t('output.kicker', { handle })}</span>
          <span className="border border-(--color-rule) px-1.5 py-0.5 text-[9px]">{t('output.polished')}</span>
        </div>
        <h1
          className="font-serif text-[clamp(36px,5vw,56px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.05] mb-4"
          data-testid="output-cover-headline"
        >
          {headline || title}
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

