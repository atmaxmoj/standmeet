// /wiki/<slug> —— SEO landing for a specific public wiki entry。
//
// SSR fetch /api/v1/wiki/:slug；404 走 Next not-found。<head> 加
// og:title / og:description / canonical 让爬虫拿到完整 metadata。owner
// handle 用 sole owner（v1 单 owner instance），URL 不再带 handle。

import type { Metadata } from 'next';
import Link from 'next/link';

import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
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
  const wiki = await fetchWikiLanding(path.join('/'));
  const instance = await fetchInstance();
  const handle = instance.handle;
  return wiki
    ? <WikiLandingContent wiki={wiki} handle={handle} slug={path.join('/')} />
    : <LockedView slug={path.join('/')} />;
}

function WikiLandingContent({ wiki, handle, slug }: {
  wiki: { title: string; body: string; seo_description: string; updated_at: string };
  handle: string;
  slug: string;
}) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        <CoverHero title={wiki.title} description={wiki.seo_description} handle={handle} updatedAt={wiki.updated_at} />
        <article className="mx-auto max-w-2xl px-6 py-16" data-testid="wiki-landing">
          <PageHeader />
          <Breadcrumb slug={slug} />
          <WikiBody body={wiki.body} />
          <TrustBox handle={handle} />
        </article>
        <AskAboutThis title={wiki.title} kind="wiki" />
      </main>
      <FloatingChatDock />
    </>
  );
}

function CoverHero({ title, description, handle, updatedAt }: {
  title: string; description: string; handle: string; updatedAt: string;
}) {
  return (
    <div className="border-b border-(--color-rule) bg-(--color-surface)/40 py-16 px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
          wiki · from {handle}&apos;s corpus
        </div>
        <h1 className="font-serif text-[clamp(36px,5vw,56px)] text-(--color-ink) font-normal tracking-[-0.02em] leading-[1.05] mb-4">
          {title}
        </h1>
        <WikiHeroMeta description={description} updatedAt={updatedAt} />
      </div>
    </div>
  );
}

function WikiHeroMeta({ description, updatedAt }: { description: string; updatedAt: string }) {
  return (
    <>
      {description && (
        <p className="reading text-[17px] text-(--color-muted) max-w-[44em]">{description}</p>
      )}
      <p className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-4">
        updated {updatedAt.slice(0, 10)}
      </p>
    </>
  );
}

function LockedView({ slug }: { slug: string }) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24">
        <div className="mx-auto max-w-2xl px-6 py-24 text-center">
          <PageHeader />
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4">
            wiki · {slug}
          </div>
          <h2 className="font-serif text-[28px] text-(--color-ink) font-normal mb-4">
            This entry requires an access code
          </h2>
          <p className="reading text-(--color-muted) text-[16px] max-w-[36em] mx-auto mb-8">
            The owner has restricted this wiki entry. Enter an access code on the gate
            to view the full content.
          </p>
          <Link
            href="/gate"
            className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 inline-block hover:bg-(--color-accent) transition-colors"
          >
            enter access code →
          </Link>
        </div>
      </main>
      <FloatingChatDock />
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

