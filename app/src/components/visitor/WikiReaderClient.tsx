// WikiReaderClient —— F-L-11 bearer-aware reader body.
//
// The reader page (Server Component) SSR-fetches the landing anonymously (published-only, for SEO/
// crawlers). The owner's access model is "published (anonymous) + code (invited scope)", so a viewer
// WITH a code must be able to READ the entries their code opens — but SSR can't see the visitor's
// localStorage token, so a gated-but-in-scope entry comes back null and the page would show
// RestrictedDoc. This client wrapper takes the SSR result as `initialWiki`; when it's null it re-
// fetches the landing (and context) WITH the stored token on mount and renders the entry if the
// backend serves it (in the code role's corpus glob). No token / out of scope → the RestrictedDoc it
// already showed stands. Published entries keep their fast SSR path untouched.

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { ChatMarkdown } from '@/components/page/markdown';
import { Attachments, CoverImage } from '@/components/visitor/CorpusMedia';
import { coverURL, expandBody } from '@/lib/corpus/media';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiScopedSubEntries } from '@/components/visitor/WikiScopedSubEntries';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import {
  loadScopedLanding, type WikiAsset, type WikiLandingEntry,
} from '@/lib/visitor/scoped-reader';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeContext, TreeNode } from '@/lib/corpus/tree';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

export type WikiRef = { path: string; title: string };

export type WikiEntry = {
  title: string; body: string; excerpt: string; updated_at: string;
  assetURLs?: Readonly<Record<string, string>>;
  // assets —— 挂在这条上的文件。附件渲成下载区;图片走正文里的 asset URI。
  assets?: readonly WikiAsset[];
  // hero —— owner 设的封面图 + 压在图上那句话。空 = 没设,退回程序生成的色板。
  coverAssetID?: string;
  coverHeadline?: string;
  tags: readonly string[];
  css_classes?: readonly string[];
  related: readonly WikiRef[];
  cited_by: readonly WikiRef[];
  sources_count: number;
};

// scopedToEntry —— WikiLandingEntry (bearer re-fetch wire) → the reader's WikiEntry shape.
function scopedToEntry(e: WikiLandingEntry): WikiEntry {
  return {
    title: e.title, body: e.body, excerpt: e.excerpt, updated_at: e.updated_at,
    assetURLs: e.asset_urls, assets: e.assets,
    coverAssetID: e.cover_image_asset_id, coverHeadline: e.cover_headline,
    tags: e.tags, css_classes: e.css_classes,
    related: e.related, cited_by: e.cited_by, sources_count: e.sources_count,
  };
}

export function WikiReaderClient({ initialWiki, handle, ownerName, slug, initialCtx, stats }: {
  initialWiki: WikiEntry | null; handle: string; ownerName: string; slug: string;
  initialCtx: TreeContext; stats: WikiTreeStats;
}) {
  const [wiki, setWiki] = useState<WikiEntry | null>(initialWiki);
  const [ctx, setCtx] = useState<TreeContext>(initialCtx);
  useEffect(
    () => loadScopedLanding(slug, initialWiki !== null, (e) => setWiki(scopedToEntry(e)), setCtx),
    [initialWiki, slug],
  );
  return wiki
    ? (
      <WikiLandingContent
        wiki={wiki} handle={handle} ownerName={ownerName} slug={slug} ctx={ctx} stats={stats}
      />
    )
    : <RestrictedDoc genre="wiki" slug={slug} />;
}

function WikiLandingContent({ wiki, handle, ownerName, slug, ctx, stats }: {
  wiki: WikiEntry; handle: string; ownerName: string; slug: string;
  ctx: TreeContext; stats: WikiTreeStats;
}) {
  return (
    <div>
      <WikiTopBar handle={handle} reading={wiki.title} />
      <SessionStrip />
      <ReaderLayout mainTestId="wiki-landing" aside={<WikiTreeView activePath={slug} stats={stats} />}>
        <div className="max-w-[920px] mx-auto pt-10 pb-24">
          <Breadcrumb
            ancestors={ctx.ancestors} current={wiki.title} updatedAt={wiki.updated_at}
            sourcesCount={wiki.sources_count}
          />
          <OgCover entry={wiki} seed={slug} />
          <MetaStrip entry={wiki} ownerName={ownerName} />
          <article className="max-w-[680px] mx-auto mt-2">
            <WikiBody
              body={wiki.body} assetURLs={wiki.assetURLs} cssClasses={wiki.css_classes}
            />
            <Attachments assets={wiki.assets} testid="wiki-attachments" />
          </article>
          <div className="max-w-[760px] mx-auto">
            <WikiScopedSubEntries slug={slug} initial={ctx.children} />
            <RelatedRail items={wiki.related} title="read next" testid="related-rail-read-next" />
            <RelatedRail items={wiki.cited_by} title="cited by" testid="related-rail-cited-by" />
            <TrustBox handle={handle} />
          </div>
        </div>
      </ReaderLayout>
      <FloatingChatDock docContext={{ title: wiki.title, path: slug, genre: 'wiki' }} />
    </div>
  );
}

// OgCover —— 21:9 hero。owner 设了封面图就铺那张图,没设就退回按 slug hash 生成的色板。
//
// 以前**只有**色板那一支:owner 通过 MCP 设了 cover_image_asset_id,访客这边照样是一块
// 程序生成的颜色 —— 而且看不出哪里不对,因为它本来就长得像个封面。
function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div className={`${styles['cover']} ${pickHue(seed)}`} data-testid="wiki-cover">
      <CoverImage
        url={coverURL(entry.coverAssetID, entry.assetURLs)} testid="wiki-cover-image"
      />
      <span className={styles['tag']}>{coverTag(entry.tags)}</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{entry.coverHeadline || head}</span>
      {sub ? <span className={styles['sub']}>{sub}</span> : null}
    </div>
  );
}

// coverTag —— 封面左上角那行小标。没有 tag 就只写 genre。
function coverTag(tags: readonly string[]): string {
  return tags[0] ? `wiki · ${tags[0]}` : 'wiki';
}

function MetaStrip({ entry, ownerName }: { entry: WikiEntry; ownerName: string }) {
  const t = useTranslations('reader');
  return (
    <header className="mt-8 mb-9" data-testid="wiki-meta">
      <div className="smallcaps flex items-baseline gap-2.5 flex-wrap mb-3">
        <span>{formatDate(entry.updated_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>{t('wiki.by')} <span className="text-(--color-ink)">{ownerName}</span></span>
        <span className="text-(--color-faint)">·</span>
        <span data-testid="wiki-sources-count">
          {t('wiki.sourcesCount', { count: entry.sources_count })}
        </span>
        {entry.tags.map((tag) => (
          <Link key={tag} href={`/writings?tag=${encodeURIComponent(tag)}`} className="ml-1.5 no-underline">
            <span className="mono text-[10px] tracking-[0.1em] text-(--color-muted) border border-(--color-rule) rounded-[2px] px-1.5 py-0.5 hover:text-(--color-ink)">
              #{tag}
            </span>
          </Link>
        ))}
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(36px,5vw,56px)] font-[380] tracking-[-0.022em] leading-[1.04] text-pretty">
        {entry.title}
      </h1>
      {entry.excerpt && (
        <p className="font-serif italic text-(--color-muted) text-[22px] leading-[1.45] font-[380] mt-4 max-w-[34em] text-pretty">
          {entry.excerpt}
        </p>
      )}
    </header>
  );
}

function Breadcrumb({ ancestors, current, updatedAt, sourcesCount }: {
  ancestors: TreeNode[]; current: string; updatedAt: string; sourcesCount: number;
}) {
  const t = useTranslations('reader');
  return (
    <nav
      className="flex items-baseline justify-between gap-4 flex-wrap mb-6"
      data-testid="wiki-breadcrumb"
    >
      <div className="smallcaps flex items-baseline gap-1.5 flex-wrap">
        <Link href="/wiki" className="text-(--color-muted) hover:text-(--color-ink)">
          {t('wiki.backToWiki')}
        </Link>
        {ancestors.map((a) => <Crumb key={a.id} node={a} />)}
        <span className="text-(--color-faint)">{'▸'}</span>
        <span className="font-serif italic text-[13px] normal-case tracking-normal text-(--color-ink)">
          {current}
        </span>
      </div>
      <span className="mono text-[10.5px] text-(--color-muted) tracking-[0.06em]">
        {t('wiki.crumbMeta', { date: formatDate(updatedAt), count: sourcesCount })}
      </span>
    </nav>
  );
}

function Crumb({ node }: { node: TreeNode }) {
  return (
    <>
      <span className="text-(--color-faint)">{'▸'}</span>
      <Link
        href={`/wiki/${node.path}`}
        className="font-serif italic text-[13px] normal-case tracking-normal text-(--color-muted) hover:text-(--color-ink)"
      >
        {node.title}
      </Link>
    </>
  );
}

function RelatedRail(
  { items, title, testid }: { items: readonly WikiRef[]; title: string; testid: string },
) {
  return items.length > 0 ? (
    <div className="mt-12" data-testid={testid}>
      <div className="smallcaps mb-3">{title}</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 list-none p-0 m-0">
        {items.map((r) => (
          <li key={r.path}>
            <Link
              href={`/wiki/${r.path}`}
              className="reading text-(--color-ink) hover:text-(--color-accent) text-[15px]"
            >
              {r.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

function WikiBody(
  { body, assetURLs, cssClasses }:
  { body: string; assetURLs?: Readonly<Record<string, string>>; cssClasses?: readonly string[] },
) {
  // 正文存的是稳定的 `standmeet-asset:<id>` URI（不会过期），渲染前才换成预签名地址。
  // 不换的话 react-markdown 的 urlTransform 会把这个非标准 scheme 剥掉 —— 图位是空的，
  // 而且不报错，所以这一步漏了没人看得出来。
  const rendered = expandBody(body, assetURLs);
  return (
    <div className="reading" data-testid="wiki-body">
      <CorpusContent classes={cssClasses}>
        <ChatMarkdown source={rendered} variant="article" />
      </CorpusContent>
    </div>
  );
}

function TrustBox({ handle }: { handle: string }) {
  const t = useTranslations('reader');
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="smallcaps mb-1.5">{t('wiki.aboutHeading')}</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        {t('wiki.aboutBody', { handle })}
      </p>
    </div>
  );
}

function pickHue(seed: string): string {
  const sum = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return [styles['hueAmber'], styles['hueViolet'], styles['hueAcid']][sum % 3] ?? '';
}

function splitTitle(title: string): { head: string; sub: string } {
  const parts = title.split(/\.\s+|:\s+/);
  return { head: parts[0] ?? title, sub: parts.slice(1).join('. ') };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
