// WritingArticle —— a single article; Stripe-Press-style density (680px
// single column / 21px font size / 1.65 line height). Private articles are
// locked per visibility.
//
// Body comes from body_md (GitHub-flavored markdown), rendered by
// react-markdown + remark-gfm; each element gets standmeet font / size /
// spacing via the components prop (see WritingArticleMarkdown.tsx),
// pixel-for-pixel matching the design against the old 3-block version.
//
// I.2: 'use client' lets react-markdown + rehype-katex + lazy MermaidBlock
// run in a client context (lazy can't render on the server). Next.js still
// SSRs the first-paint HTML — only the component tree is now client; SEO is
// unaffected (metadata comes from generateMetadata at the page.tsx layer,
// separate from component rendering).

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Markdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';

import { useCorpusHref } from '@/lib/corpus/use-corpus-href';
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

// Backlinks —— "linked from" section; lists other published writings that
// reference this one via [[X]]. Renders nothing when empty.
function Backlinks({ refs }: { refs: BacklinkRef[] }) {
  const t = useTranslations('writings.article');
  const href = useCorpusHref();
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
              href={href({ genre: 'writing', slug: r.slug })}
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
      {/* Language switcher for multi-language writings. It **shares the same
          component** as the wiki reader — that surface always had it, this
          one never did, so a reader hit a dead end on whichever version they
          landed on first (F-R-6). The component renders nothing when there
          are fewer than two languages.

          Right-alignment is decided by **whoever places it**, not baked into
          the component: the same switcher is also used by the wiki reader,
          whose layout is a different matter. The component owns "what to
          switch"; placement belongs to its caller. */}
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
  // Expand standmeet-asset:<id> URIs → presigned URLs before feeding
  // react-markdown. react-markdown's default urlTransform strips
  // non-standard schemes (XSS protection); converting to an https URL first
  // avoids tripping that rule. Orphan tracking runs on body_md
  // (source-of-truth); rendering is a view-only transform.
  // promoteDisplayMath: promotes single-line `$$…$$` (the Obsidian /
  // real-vault convention) into fenced form → display math (F-R-3).
  // escapeCurrencyDollars: renders amounts like $100/$200 literally, so
  // remark-math doesn't swallow them as formulas.
  // expandBody is the shared step from the corpus module (URI → accessible
  // address). The two wrapping calls are math-typesetting handling specific
  // to writings, and stay here.
  const rendered = escapeCurrencyDollars(promoteDisplayMath(expandBody(bodyMD, assetURLs)));
  return (
    <article
      className={`max-w-[680px] mx-auto px-6 lg:px-0 text-(--color-ink) ${markdownStyles.body}`}
      data-testid="writing-article-body"
    >
      <CorpusContent>
        {/* The pipeline is **the same one** used by wiki / chat
            (`CORPUS_REMARK_PLUGINS`). This file used to configure its own
            second pipeline (gfm + math only), so the same owner markdown
            rendered two different results across surfaces — Chinese
            `**bold.**` degraded to literal asterisks here while rendering
            correctly on the other surface. */}
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
