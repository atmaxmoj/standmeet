// /wiki/<slug> —— SEO landing for a specific public wiki entry。
//
// SSR fetch /api/v1/wiki/:slug；404 走 RestrictedDoc。<head> 加 og:title /
// description / canonical 让爬虫拿到完整 metadata。owner handle 用 sole owner
// (v1 单 owner instance)。
//
// 版式对齐设计 wiki.js:OG cover(21:9 hue hero)→ breadcrumb(← writing)→
// metadata strip(date · by + serif h1 + italic excerpt)→ article-body
// (编辑级阅读排版,走 ChatMarkdown variant="article")→ about box。
// ask composer(AskAboutThis + FloatingChatDock)按 owner 要求**保留现状**。

import type { Metadata } from 'next';
import Link from 'next/link';

import { ChatMarkdown } from '@/components/page/markdown';
import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiLanding } from '@/lib/api/public';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

// catch-all [...path]：path 可含 `/` (projects/lucerna 这种分组)。
type Params = { path: string[] };

type WikiEntry = { title: string; body: string; seo_description: string; updated_at: string };

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { path } = await params;
  const wiki = await fetchWikiLanding(path.join('/'));
  return wiki ? {
    title: wiki.title,
    description: wiki.seo_description || wiki.body.slice(0, 160),
    openGraph: { title: wiki.title, description: wiki.seo_description, type: 'article' },
  } : { title: 'not found' };
}

export default async function WikiLandingPage({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const slug = path.join('/');
  const wiki = await fetchWikiLanding(slug);
  const instance = await fetchInstance();
  return wiki
    ? <WikiLandingContent wiki={wiki} handle={instance.handle} slug={slug} />
    : <RestrictedDoc genre="wiki" slug={slug} />;
}

function WikiLandingContent({ wiki, handle, slug }: {
  wiki: WikiEntry; handle: string; slug: string;
}) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24" data-testid="wiki-landing">
        <div className="mx-auto max-w-[920px] px-6 pt-10">
          <Breadcrumb slug={slug} />
          <OgCover entry={wiki} seed={slug} />
          <MetaStrip entry={wiki} handle={handle} />
        </div>
        <article className="mx-auto max-w-[680px] px-6 mt-2">
          <WikiBody body={wiki.body} />
        </article>
        <div className="mx-auto max-w-[760px] px-6">
          <TrustBox handle={handle} />
        </div>
        <AskAboutThis title={wiki.title} kind="wiki" />
      </main>
      <FloatingChatDock />
    </>
  );
}

// OgCover —— 21:9 hue hero。headline = 标题第一句,sub = 第二句(无则空);
// hue 由 slug 派生(amber/violet/acid 轮替,确定性)。tag/日期角标。
function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div className={`${styles['cover']} ${pickHue(seed)}`} data-testid="wiki-cover">
      <span className={styles['tag']}>wiki · corpus</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{head}</span>
      {sub ? <span className={styles['sub']}>{sub}</span> : null}
    </div>
  );
}

// MetaStrip —— cover 下的文章抬头:smallcaps(日期 · by owner)+ 大 serif h1
// + italic excerpt。对齐设计 metadata strip(无 tags/sources 数据,从略)。
function MetaStrip({ entry, handle }: { entry: WikiEntry; handle: string }) {
  return (
    <header className="mt-8 mb-9">
      <div className="smallcaps flex items-baseline gap-2.5 flex-wrap mb-3">
        <span>{formatDate(entry.updated_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>by <span className="text-(--color-ink)">{handle}</span></span>
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(36px,5vw,56px)] font-[380] tracking-[-0.022em] leading-[1.04] text-pretty">
        {entry.title}
      </h1>
      {entry.seo_description && (
        <p className="font-serif italic text-(--color-muted) text-[22px] leading-[1.45] font-[380] mt-4 max-w-[34em] text-pretty">
          {entry.seo_description}
        </p>
      )}
    </header>
  );
}

// Breadcrumb —— ← writing / wiki · slug。「← writing」替代旧的「← home」,
// document 页统一返回 writing index(task #39)。
function Breadcrumb({ slug }: { slug: string }) {
  return (
    <div className="smallcaps flex items-baseline gap-2 flex-wrap">
      <Link href="/writings" className="text-(--color-muted) hover:text-(--color-ink)">← writing</Link>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-ink)">wiki · {slug}</span>
    </div>
  );
}

function WikiBody({ body }: { body: string }) {
  // article variant —— 编辑级阅读排版(p 21/1.65、h2 serif 26、blockquote
  // accent);跟 chat answer 同一条 markdown 管线 (gfm + math + mermaid + sanitize)。
  return (
    <div className="reading" data-testid="wiki-body">
      <ChatMarkdown source={body} variant="article" />
    </div>
  );
}

function TrustBox({ handle }: { handle: string }) {
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="smallcaps mb-1.5">about this entry</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        One of {handle}&apos;s wiki entries. The AI on this site is grounded in the same
        corpus, so you can ask follow-ups below and get answers in his voice with
        citations back to entries like this one.
      </p>
    </div>
  );
}

// pickHue —— slug 字符和确定性选 amber/violet/acid,同一篇恒定同色。
function pickHue(seed: string): string {
  const sum = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return [styles['hueAmber'], styles['hueViolet'], styles['hueAcid']][sum % 3] ?? '';
}

// splitTitle —— 标题按「. 」/「: 」切:第一段当 cover 大标题,其余当副标。
function splitTitle(title: string): { head: string; sub: string } {
  const parts = title.split(/\.\s+|:\s+/);
  return { head: parts[0] ?? title, sub: parts.slice(1).join('. ') };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
