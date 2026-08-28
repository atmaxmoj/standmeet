// WritingArticle —— 单篇文章；Stripe-Press 风密度 (680px 单栏 / 21px 字号 /
// 1.65 行高)。private 文章按 visibility 锁。
//
// body 来自 body_md (GitHub-flavored markdown)，react-markdown + remark-gfm
// 渲染，每种 element 通过 components prop 套上 standmeet 字体 / 字号 / 间距
// (见 WritingArticleMarkdown.tsx)，pixel-for-pixel 跟旧 3-block 版本对齐设计稿。
//
// I.2: 'use client' 让 react-markdown + rehype-katex + lazy MermaidBlock 在
// client 上下文跑 (lazy 不能在 server 渲染)。Next.js 仍 SSR 出首屏 HTML，
// 只是 component tree 已是 client；SEO 不受影响 (metadata 在 page.tsx 那
// 层 generateMetadata 出，跟 component 渲染分离)。

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';

import { corpusHref } from '@/lib/corpus/href';
import type { BacklinkRef, WritingView } from '@/lib/api/public';
import { Cover } from '@/components/writings/Cover';
import { CorpusContent } from '@/components/page/CorpusContent';
import { markdownComponents, markdownStyles } from '@/components/writings/WritingArticleMarkdown';
import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { CORPUS_REMARK_PLUGINS } from '@/components/page/markdown';
import { LanguageSwitch } from '@/components/visitor/LanguageSwitch';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { expandBody } from '@/lib/corpus/media';
import { escapeCurrencyDollars, promoteDisplayMath } from '@/components/page/markdown-helpers';

interface Props {
  writing: WritingView;
}

export function WritingArticle({ writing }: Props) {
  return isLocked(writing) ? <LockedView writing={writing} /> : <UnlockedView writing={writing} />;
}

function isLocked(writing: WritingView): boolean {
  return writing.visibility === 'private' && writing.body_md.trim() === '';
}

function UnlockedView({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings.article');
  const assetURLs = writing.asset_urls ?? {};
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <SessionStrip />
      <ArticleTopBar />
      <main className="pb-24">
        <Breadcrumb />
        <div className="max-w-[920px] mx-auto px-6 lg:px-0 mt-6 mb-12">
          <Cover
            cover={writing}
            assetURLs={assetURLs}
            no={t('coverNo', { date: formatDate(writing.published_at) })}
          />
        </div>
        <ArticleHeader writing={writing} />
        <Body bodyMD={writing.body_md} assetURLs={assetURLs} />
        <Backlinks refs={writing.backlinks ?? []} />
        <AskAboutThis title={writing.title} kind="essay" />
      </main>
      <FloatingChatDock docContext={{ title: writing.title, path: writing.slug, genre: 'writing' }} />
    </div>
  );
}

// Backlinks —— "linked from" section；列举其它 published writing 通过 [[X]]
// 引到本篇的来源。空就不渲染。
function Backlinks({ refs }: { refs: BacklinkRef[] }) {
  const t = useTranslations('writings.article');
  return refs.length === 0 ? null : (
    <aside
      className="max-w-[680px] mx-auto px-6 lg:px-0 mt-16 pt-8 border-t border-(--color-rule)"
      data-testid="writing-article-backlinks"
    >
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        {t('linkedFrom')}
      </div>
      <ul className="font-serif text-[18px] leading-[1.55] space-y-2">
        {refs.map((r) => (
          <li key={r.slug} data-testid={`backlink-${r.slug}`}>
            <Link
              href={corpusHref({ genre: 'writing', slug: r.slug })}
              className="text-(--color-ink) hover:text-(--color-accent)"
            >
              {r.title}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function ArticleTopBar() {
  const t = useTranslations('writings.common');
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <Link href="/" className="text-(--color-ink)">{t('brand')}</Link>
        <span className="text-(--color-faint) mx-1">·</span>
        <Link href="/writings" className="text-(--color-accent)">{t('writings')}</Link>
      </div>
    </header>
  );
}

function Breadcrumb() {
  const t = useTranslations('writings.common');
  return (
    <div className="max-w-[920px] mx-auto px-6 lg:px-0 pt-10">
      <Link
        href="/writings"
        className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('backToWritings')}
      </Link>
    </div>
  );
}

function ArticleHeader({ writing }: { writing: WritingView }) {
  return (
    <header className="max-w-[760px] mx-auto px-6 lg:px-0 mb-10">
      <ArticleMeta writing={writing} />
      <h1
        className="font-serif text-(--color-ink) text-[clamp(40px,5.6vw,64px)] font-[380] tracking-[-0.022em] leading-[1.04]"
        data-testid="writing-article-title"
      >
        {writing.title}
      </h1>
      <p className="italic text-(--color-muted) mt-6 max-w-[34em] text-[22px] leading-[1.45] font-[380]">
        {writing.excerpt}
      </p>
      {/* 多语 writing 的切换器。跟 wiki reader **共用同一个组件** —— 那边一直有，
          这边一直没有，读者拿到一面就到头了（F-R-6）。少于两种语言时组件自己不渲染。

          靠右由**摆放它的这一侧**决定，不写进组件里：同一个切换器 wiki reader 也在用，
          而那边的版式是另一回事。组件负责「切什么」，位置归用它的人。 */}
      <div className="mt-5 flex justify-end">
        <LanguageSwitch
          languages={writing.languages ?? []}
          current={writing.lang ?? ''}
        />
      </div>
    </header>
  );
}

function ArticleMeta({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings.common');
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4 flex items-baseline gap-3 flex-wrap">
      <span>{formatDate(writing.published_at)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{t('readMinutes', { minutes: writing.read_minutes })}</span>
      {writing.tags.map((t) => <TagLink key={t} tag={t} />)}
    </div>
  );
}

function TagLink({ tag }: { tag: string }) {
  return (
    <Link
      href={`/writings?tag=${encodeURIComponent(tag)}`}
      className="mono text-[10.5px] tracking-[0.05em] uppercase border border-(--color-rule) text-(--color-muted) px-2 py-0.5 ml-1 rounded-[2px] hover:text-(--color-ink)"
    >
      #{tag}
    </Link>
  );
}

function Body({ bodyMD, assetURLs }: { bodyMD: string; assetURLs: Record<string, string> }) {
  // expand standmeet-asset:<id> URIs → presigned URLs 之后再 feed react-markdown。
  // react-markdown 默认 urlTransform 会 strip 非标准 scheme（XSS 保护）；先
  // 替成 https URL 不踩这条规则。orphan 追踪走 body_md（source-of-truth），
  // render 是 view-only 变换。
  // promoteDisplayMath:单行 `$$…$$`(Obsidian/真 vault 写法)提成 fenced 形式 → display(F-R-3)。
  // escapeCurrencyDollars:$100/$200 等金额按字面渲,不被 remark-math 当公式吃掉。
  // expandBody 是 corpus 那套共用的那一步(URI → 可访问地址)。外面那两层是 writings
  // 独有的数学排版处理,留着。
  const rendered = escapeCurrencyDollars(promoteDisplayMath(expandBody(bodyMD, assetURLs)));
  return (
    <article
      className={`max-w-[680px] mx-auto px-6 lg:px-0 text-(--color-ink) ${markdownStyles.body}`}
      data-testid="writing-article-body"
    >
      <CorpusContent>
        {/* 管线跟 wiki / chat **同一份**（`CORPUS_REMARK_PLUGINS`）。这里以前自己配了
            第二套（只有 gfm + math），于是同一批 owner markdown 在两个面上渲出两种结果 ——
            中文的 `**粗体。**` 在这一面退化成字面星号，而在另一面是对的。 */}
        <Markdown
          remarkPlugins={CORPUS_REMARK_PLUGINS}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents}
        >
          {rendered}
        </Markdown>
      </CorpusContent>
    </article>
  );
}

function LockedView({ writing }: { writing: WritingView }) {
  const t = useTranslations('writings.article');
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <main className="max-w-[760px] mx-auto px-6 lg:px-0 py-20 text-center">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
          {t('privateEssay')}
        </div>
        <h1 className="font-serif text-(--color-ink) text-[clamp(36px,5vw,56px)] font-[380] tracking-[-0.018em] leading-[1.05]">
          {writing.title}<span className="text-(--color-accent)">.</span>
        </h1>
        <p className="text-(--color-muted) mt-6 max-w-[34em] mx-auto text-[18px]">
          {writing.locked_body ?? t('lockedBody')}
        </p>
        <LockedActions />
      </main>
    </div>
  );
}

function LockedActions() {
  const t = useTranslations('writings');
  return (
    <div className="mt-8 flex flex-wrap items-baseline justify-center gap-4">
      <Link
        href="/gate#request"
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors"
      >
        {t('article.requestInvite')}
      </Link>
      <Link
        href="/writings"
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('common.backToWritings')}
      </Link>
    </div>
  );
}

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '.') : '';
}
