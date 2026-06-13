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
import { WikiTreeAside } from '@/components/visitor/WikiTreeAside';
import { fetchInstance } from '@/lib/api/instance';
import { fetchWikiContext, fetchWikiLanding } from '@/lib/api/public';
import type { TreeContext, TreeNode } from '@/lib/corpus/tree';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

// catch-all [...path]：path 可含 `/` (projects/lucerna 这种分组)。
type Params = { path: string[] };

type WikiEntry = {
  title: string; body: string; seo_description: string; updated_at: string;
  tags: readonly string[];
};

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
  const ctx = await fetchWikiContext(slug);
  return wiki
    ? <WikiLandingContent
        wiki={wiki} handle={instance.handle} ownerName={instance.name || instance.handle}
        slug={slug} ctx={ctx} />
    : <RestrictedDoc genre="wiki" slug={slug} />;
}

function WikiLandingContent({ wiki, handle, ownerName, slug, ctx }: {
  wiki: WikiEntry; handle: string; ownerName: string; slug: string; ctx: TreeContext;
}) {
  return (
    <>
      <SessionStrip />
      <main className="pb-24" data-testid="wiki-landing">
        <div className="mx-auto max-w-[1180px] px-6 pt-10 flex gap-12 items-start">
          <div className="hidden lg:block">
            <WikiTreeAside activePath={slug} />
          </div>
          <div className="min-w-0 flex-1">
            <Breadcrumb ancestors={ctx.ancestors} current={wiki.title} />
            <OgCover entry={wiki} seed={slug} />
            <MetaStrip entry={wiki} ownerName={ownerName} />
            <article className="max-w-[680px] mt-2">
              <WikiBody body={wiki.body} />
            </article>
            <div className="max-w-[760px]">
              <SubEntriesRail nodes={ctx.children} />
              <TrustBox handle={handle} />
            </div>
          </div>
        </div>
        <AskAboutThis title={wiki.title} kind="wiki" />
      </main>
      <FloatingChatDock docContext={{ title: wiki.title, path: slug, genre: 'wiki' }} />
    </>
  );
}

// OgCover —— 21:9 hue hero。headline = 标题第一句,sub = 第二句(无则空);
// hue 由 slug 派生(amber/violet/acid 轮替,确定性)。tag/日期角标。
function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div className={`${styles['cover']} ${pickHue(seed)}`} data-testid="wiki-cover">
      <span className={styles['tag']}>wiki · {entry.tags[0] ?? 'corpus'}</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{head}</span>
      {sub ? <span className={styles['sub']}>{sub}</span> : null}
    </div>
  );
}

// MetaStrip —— cover 下的文章抬头:smallcaps(日期 · by owner 全名 · tag chips)
// + 大 serif h1 + italic excerpt。对齐设计 metadata strip。
function MetaStrip({ entry, ownerName }: { entry: WikiEntry; ownerName: string }) {
  return (
    <header className="mt-8 mb-9" data-testid="wiki-meta">
      <div className="smallcaps flex items-baseline gap-2.5 flex-wrap mb-3">
        <span>{formatDate(entry.updated_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>by <span className="text-(--color-ink)">{ownerName}</span></span>
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
      {entry.seo_description && (
        <p className="font-serif italic text-(--color-muted) text-[22px] leading-[1.45] font-[380] mt-4 max-w-[34em] text-pretty">
          {entry.seo_description}
        </p>
      )}
    </header>
  );
}

// Breadcrumb —— ← writing / wiki ▸ 祖先链 ▸ 当前条。祖先来自 context(scope
// 过滤,gated 祖先不出现),每个可点回各自 landing;当前条纯文字。「← writing」
// 替代旧「← home」,document 页统一返回 writing index(task #39)。
function Breadcrumb({ ancestors, current }: { ancestors: TreeNode[]; current: string }) {
  return (
    <nav className="smallcaps flex items-baseline gap-2 flex-wrap" data-testid="wiki-breadcrumb">
      <Link href="/writings" className="text-(--color-muted) hover:text-(--color-ink)">← writing</Link>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-muted)">wiki</span>
      {ancestors.map((a) => <Crumb key={a.id} node={a} />)}
      <span className="text-(--color-faint)">▸</span>
      <span className="text-(--color-ink)">{current}</span>
    </nav>
  );
}

function Crumb({ node }: { node: TreeNode }) {
  return (
    <>
      <span className="text-(--color-faint)">▸</span>
      <Link href={`/wiki/${node.path}`} className="text-(--color-muted) hover:text-(--color-ink)">
        {node.title}
      </Link>
    </>
  );
}

// SubEntriesRail —— 当前条目的直接子条目(树派生),没有则不渲染。
function SubEntriesRail({ nodes }: { nodes: TreeNode[] }) {
  return nodes.length > 0 ? (
    <div className="mt-12" data-testid="wiki-subentries">
      <div className="smallcaps mb-3">sub-entries</div>
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
