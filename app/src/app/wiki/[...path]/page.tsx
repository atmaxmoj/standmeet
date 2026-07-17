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
import { getTranslations } from 'next-intl/server';

import { ChatMarkdown } from '@/components/page/markdown';
import { CorpusContent } from '@/components/page/CorpusContent';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiContext, fetchWikiLanding, fetchWikiTreeStats } from '@/lib/api/public';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeContext, TreeNode } from '@/lib/corpus/tree';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

// catch-all [...path]：path 可含 `/` (projects/lucerna 这种分组)。
type Params = { path: string[] };

type WikiRef = { path: string; title: string };

type WikiEntry = {
  title: string; body: string; excerpt: string; updated_at: string;
  tags: readonly string[];
  css_classes?: readonly string[];
  related: readonly WikiRef[];
  cited_by: readonly WikiRef[];
  sources_count: number;
};

export async function generateMetadata(
  { params }: { params: Promise<Params> },
): Promise<Metadata> {
  const { path } = await params;
  const wiki = await fetchWikiLanding(path.join('/'));
  return wiki ? {
    title: wiki.title,
    description: wiki.excerpt || wiki.body.slice(0, 160),
    openGraph: { title: wiki.title, description: wiki.excerpt, type: 'article' },
  } : { title: 'not found' };
}

export default async function WikiLandingPage({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const slug = path.join('/');
  const [wiki, instance, ctx, stats] = await Promise.all([
    fetchWikiLanding(slug), fetchInstance(), fetchWikiContext(slug), fetchWikiTreeStats(),
  ]);
  return wiki
    ? <WikiLandingContent
        wiki={wiki} handle={instance.handle} ownerName={instance.name || instance.handle}
        slug={slug} ctx={ctx} stats={stats} />
    : <RestrictedDoc genre="wiki" slug={slug} />;
}

function WikiLandingContent({ wiki, handle, ownerName, slug, ctx, stats }: {
  wiki: WikiEntry; handle: string; ownerName: string; slug: string;
  ctx: TreeContext; stats: WikiTreeStats;
}) {
  // 对齐设计 wiki.js:TopBar(全宽)→ SessionStrip(sticky)→ wiki-frame(全宽,左
  // toc 贴左沿 + 分割线 + sticky 自滚 + 可拖宽,右正文 max-w 920 居中、body 680 /
  // rails 760 再内收)。文档整体滚动 —— 长文一定够得到底;toc sticky 不跟文章动。
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
            <WikiBody body={wiki.body} cssClasses={wiki.css_classes} />
          </article>
          <div className="max-w-[760px] mx-auto">
            <SubEntriesRail nodes={ctx.children} />
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

// OgCover —— 21:9 hue hero。headline = 标题第一句,sub = 第二句(无则空);
// hue 由 slug 派生(amber/violet/acid 轮替,确定性)。tag/日期角标。
function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div className={`${styles['cover']} ${pickHue(seed)}`} data-testid="wiki-cover">
      <span className={styles['tag']}>{entry.tags[0] ? `wiki · ${entry.tags[0]}` : 'wiki'}</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{head}</span>
      {sub ? <span className={styles['sub']}>{sub}</span> : null}
    </div>
  );
}

// MetaStrip —— cover 下的文章抬头:smallcaps(日期 · by owner 全名 · tag chips)
// + 大 serif h1 + italic excerpt。对齐设计 metadata strip。
async function MetaStrip({ entry, ownerName }: { entry: WikiEntry; ownerName: string }) {
  const t = await getTranslations('reader');
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
        {entry.tags.map((t) => (
          <Link key={t} href={`/writings?tag=${encodeURIComponent(t)}`} className="ml-1.5 no-underline">
            <span className="mono text-[10px] tracking-[0.1em] text-(--color-muted) border border-(--color-rule) rounded-[2px] px-1.5 py-0.5 hover:text-(--color-ink)">
              #{t}
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

// Breadcrumb —— ← wiki ▸ 祖先链 ▸ 当前条。祖先来自 context(scope 过滤,gated
// 祖先不出现),每个可点回各自 landing;当前条纯文字。「← wiki」回 wiki 自己的
// index —— 每种 document 返回自己那类(owner 要求),不再统一回 writing。
async function Breadcrumb({ ancestors, current, updatedAt, sourcesCount }: {
  ancestors: TreeNode[]; current: string; updatedAt: string; sourcesCount: number;
}) {
  const t = await getTranslations('reader');
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

// SubEntriesRail —— 当前条目的直接子条目(树派生),没有则不渲染。
async function SubEntriesRail({ nodes }: { nodes: TreeNode[] }) {
  const t = await getTranslations('reader');
  return nodes.length > 0 ? (
    <div className="mt-12" data-testid="wiki-subentries">
      <div className="smallcaps mb-3">{t('wiki.subEntries')}</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 list-none p-0 m-0">
        {nodes.map((c) => (
          <li key={c.id}>
            <Link
              href={`/wiki/${c.path}`}
              className="reading text-(--color-ink) hover:text-(--color-accent) text-[15px]"
            >
              {c.title} <span className="text-(--color-faint)">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

// RelatedRail —— 底部 read next(出链 related)/ cited by(入链 cited_by)。每项是
// 指向另一条 wiki 的标题链接;空则不渲染(出/入链各自独立)。
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

function WikiBody({ body, cssClasses }: {
  body: string; cssClasses?: readonly string[];
}) {
  // article variant —— 编辑级阅读排版(p 21/1.65、h2 serif 26、blockquote
  // accent);跟 chat answer 同一条 markdown 管线 (gfm + math + mermaid + sanitize)。
  return (
    <div className="reading" data-testid="wiki-body">
      <CorpusContent classes={cssClasses}>
        <ChatMarkdown source={body} variant="article" />
      </CorpusContent>
    </div>
  );
}

async function TrustBox({ handle }: { handle: string }) {
  const t = await getTranslations('reader');
  return (
    <div className="mt-12 px-4 py-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/50">
      <div className="smallcaps mb-1.5">{t('wiki.aboutHeading')}</div>
      <p className="reading text-(--color-muted) text-[13.5px] m-0">
        {t('wiki.aboutBody', { handle })}
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
