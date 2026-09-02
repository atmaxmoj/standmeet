// /output/<slug> -- SEO landing for a polished output entry.
//
// The "output" layer of raw -> wiki -> output: the finished layer that can be quoted
// verbatim in a conversation. SSR fetches /api/v1/output/:slug; 404 falls through to
// Next's not-found. <head> adds og:title / og:description / canonical.

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

// catch-all [...path]: path can contain `/`-separated segments.
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

// OutputCoverHero -- renders the owner's cover image if set, otherwise the original
// flat background color. The headline prefers the line the owner wrote to overlay the
// image; falls back to the title when unset.
//
// The third piece of the hero trio (the hue) previously had **no render slot** on this
// path: the owner picked "acid" in the editor, the backend stored it and the payload
// carried it, but the output hero always rendered a fixed background color (F-L-34).
// If the owner never picked one it stays that same flat color -- unlike the wiki hero,
// this one carries the title and date, so it isn't a shell that "shouldn't exist when unset".
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
  // #39: the document page now always returns to the writing index, no longer "back home" to /.
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

