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
import { LanguageSwitch } from '@/components/visitor/LanguageSwitch';
import { ReaderLayout } from '@/components/visitor/ReaderLayout';
import { RestrictedDoc } from '@/components/visitor/RestrictedDoc';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { WikiScopedSubEntries } from '@/components/visitor/WikiScopedSubEntries';
import { WikiTopBar } from '@/components/visitor/WikiTopBar';
import { WikiTreeView } from '@/components/visitor/WikiTreeView';
import { loadScopedLanding, type WikiLandingEntry } from '@/lib/visitor/scoped-reader';
import type { WikiTreeStats } from '@/lib/api/public';
import type { TreeContext, TreeNode } from '@/lib/corpus/tree';

import styles from '@/app/wiki/[...path]/wiki-landing.module.css';

export type WikiRef = { path: string; title: string };

// WikiEntry —— reader 读的那条笔记,**就是** landing 载荷解析出来的形状(见
// `parseWikiLanding`)。这里以前另有一份手写的 camelCase 类型 + 一个只有客户端重取那条路
// 会调的映射函数;SSR 那条路把后端载荷直接传进来,而两边同名的字段刚好够类型检查通过 ——
// 已发布笔记的 hero 图、hero 那句话、正文配图于是一声不响地全没了(F-L-33)。
// 一个形状,没有第二份可漏。
export type WikiEntry = WikiLandingEntry;

export function WikiReaderClient({
  initialWiki, handle, ownerName, slug, initialCtx, stats, lang = '',
}: {
  initialWiki: WikiEntry | null; handle: string; ownerName: string; slug: string;
  initialCtx: TreeContext; stats: WikiTreeStats; lang?: string;
}) {
  const [wiki, setWiki] = useState<WikiEntry | null>(initialWiki);
  const [ctx, setCtx] = useState<TreeContext>(initialCtx);
  useEffect(
    () => loadScopedLanding(slug, initialWiki !== null, setWiki, setCtx, lang),
    [initialWiki, slug, lang],
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
          <Breadcrumb ancestors={ctx.ancestors} current={wiki.title} />
          <OgCoverMaybe entry={wiki} seed={slug} />
          <MetaStrip entry={wiki} ownerName={ownerName} />
          <div className="max-w-[680px] mx-auto mt-3">
            <LanguageSwitch languages={wiki.languages ?? []} current={wiki.lang ?? ''} />
          </div>
          <article className="max-w-[680px] mx-auto mt-2">
            <WikiBody
              body={wiki.body} assetURLs={wiki.asset_urls} cssClasses={wiki.css_classes}
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

// OgCoverMaybe —— hero 是 owner **设出来的**东西:三件套(图 / 压在图上那句 / 色调)
// 一件都没设 = 这条笔记没有 hero,顶上什么也不渲。
//
// 以前它无条件铺一块 21:9(约 400px)。没有封面图时那块是按 slug 哈希生成的渐变,上面只印
// 标题和日期 —— 而这两样下面那条 meta 里各有一份。真 vault 的一条稠密数学笔记,第一屏几乎
// 全是空色块,正文被顶到折叠线以下。corpus-media 的 check 4 把这件事逐字写了两遍:
// 「An entry with no hero renders no empty hero shell」(F-L-32)。
function OgCoverMaybe({ entry, seed }: { entry: WikiEntry; seed: string }) {
  return hasHero(entry) ? <OgCover entry={entry} seed={seed} /> : null;
}

// hasHero —— owner **写进去过**东西才算他要这块 hero:一张封面图,或者压在上面那句话。
//
// ⚠️ **色调不算证据**,哪怕它有值。`corpus_notes.cover_hue` 是 `NOT NULL DEFAULT 'amber'`
// (`backend/db/schema.sql:192`),所以每一条笔记读回来都带着 `amber` —— 包括 owner 从没打开过
// 编辑器的那 575 条。把「hue 非空」当成「他挑过色调」,这个判断对整个真实语料**恒为真**,
// F-L-32 的修法就等于没改(admin 表单里那个 `— default —` 选项同理:存进去也还是 amber,
// 那个「未设置」的状态在库里根本表达不出来)。
// 这一条是在真实环境驱 corpus-acl-editing 时,从表单上看到「HUE: amber」而那条笔记
// 显然没有封面,才顺着 schema 查出来的。
function hasHero(entry: WikiEntry): boolean {
  return entry.cover_image_asset_id !== '' || entry.cover_headline !== '';
}

function OgCover({ entry, seed }: { entry: WikiEntry; seed: string }) {
  const { head, sub } = splitTitle(entry.title);
  return (
    <div
      className={styles['cover']}
      data-hue={heroHue(entry.cover_hue, seed)}
      data-testid="wiki-cover"
    >
      <CoverImage
        url={coverURL(entry.cover_image_asset_id, entry.asset_urls)} testid="wiki-cover-image"
      />
      <span className={styles['tag']}>{coverTag(entry.tags)}</span>
      <span className={styles['no']}>{formatDate(entry.updated_at)}</span>
      <span className={styles['head']}>{entry.cover_headline || head}</span>
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

// Breadcrumb —— **只回答「我在哪」**。
//
// 它右端曾经还挂着 `{date} · {count} sources cited`，而同样这两件事在下面那条 meta 里
// 各有一份（`… · BY … · 0 CORPUS SOURCES`）—— 同一屏说两遍、还换了一套词（UX-85）。
// 这份重复以前被记成「留给 owner 定」，理由是 `wiki-meta-row.spec.ts` 那条守卫的名字
// 逐字写着两处各说一遍。**那条守卫记录的是这份重复本身，不是产品要求**
// （[[parked-test-carries-a-wrong-diagnosis]]）：判据（一件事一屏说一遍）赢，守卫跟着改。
//
// 分工现在是死的：面包屑导航，meta 行讲这条笔记（谁写的、什么时候、引了几条）。
function Breadcrumb({ ancestors, current }: {
  ancestors: TreeNode[]; current: string;
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

// heroHue —— 上色用哪一个。**owner 选的那个优先**:他在 hero 编辑器里挑了 acid,后端存了、
// 载荷也发了,而这里以前直接按 slug 哈希 —— 那个选择从来没到过页面上(F-L-34)。
// 他没挑(只设了图或只写了句话)才按 slug 派一个,同一条笔记每次都是同一个色。
function heroHue(chosen: string, seed: string): Hue {
  return isHue(chosen) ? chosen : hashHue(seed);
}

const HUES = ['amber', 'violet', 'acid'] as const;
type Hue = (typeof HUES)[number];

function isHue(v: string): v is Hue {
  return HUES.some((h) => h === v);
}

function hashHue(seed: string): Hue {
  const sum = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return HUES[sum % HUES.length] ?? 'amber';
}

function splitTitle(title: string): { head: string; sub: string } {
  const parts = title.split(/\.\s+|:\s+/);
  return { head: parts[0] ?? title, sub: parts.slice(1).join('. ') };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
