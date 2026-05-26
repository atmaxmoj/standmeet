// BlogArticle —— 单篇文章；Stripe-Press 风密度 (680px 单栏 / 21px 字号 /
// 1.65 行高)。private 文章按 visibility 锁。
//
// body 来自 body_md (GitHub-flavored markdown)，react-markdown + remark-gfm
// 渲染，每种 element 通过 components prop 套上 standmeet 字体 / 字号 / 间距
// (见 BlogArticleMarkdown.tsx)，pixel-for-pixel 跟旧 3-block 版本对齐设计稿。

import Link from 'next/link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { BacklinkRef, PostView } from '@/lib/api/public';
import { Cover } from '@/components/blog/Cover';
import { markdownComponents, markdownStyles } from '@/components/blog/BlogArticleMarkdown';
import { AskAboutThis } from '@/components/visitor/AskAboutThis';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { expandURIsToURLs } from '@/lib/blog/asset-transforms';

interface Props {
  post: PostView;
}

export function BlogArticle({ post }: Props) {
  return isLocked(post) ? <LockedView post={post} /> : <UnlockedView post={post} />;
}

function isLocked(post: PostView): boolean {
  return post.visibility === 'private' && post.body_md.trim() === '';
}

function UnlockedView({ post }: { post: PostView }) {
  const assetURLs = post.asset_urls ?? {};
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <SessionStrip />
      <ArticleTopBar />
      <main className="pb-24">
        <Breadcrumb />
        <div className="max-w-[920px] mx-auto px-6 lg:px-0 mt-6 mb-12">
          <Cover
            cover={post}
            assetURLs={assetURLs}
            no={formatDate(post.published_at) + ' · essay'}
          />
        </div>
        <ArticleHeader post={post} />
        <Body bodyMD={post.body_md} assetURLs={assetURLs} />
        <Backlinks refs={post.backlinks ?? []} />
        <AskAboutThis title={post.title} kind="essay" />
      </main>
      <FloatingChatDock />
    </div>
  );
}

// Backlinks —— "linked from" section；列举其它 published post 通过 [[X]]
// 引到本篇的来源。空就不渲染。
function Backlinks({ refs }: { refs: BacklinkRef[] }) {
  return refs.length === 0 ? null : (
    <aside
      className="max-w-[680px] mx-auto px-6 lg:px-0 mt-16 pt-8 border-t border-(--color-rule)"
      data-testid="blog-article-backlinks"
    >
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        linked from
      </div>
      <ul className="font-serif text-[18px] leading-[1.55] space-y-2">
        {refs.map((r) => (
          <li key={r.slug} data-testid={`backlink-${r.slug}`}>
            <Link
              href={`/blog/${r.slug}`}
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
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <Link href="/" className="text-(--color-ink)">standmeet</Link>
        <span className="text-(--color-faint) mx-1">·</span>
        <Link href="/blog" className="text-(--color-accent)">writing</Link>
      </div>
    </header>
  );
}

function Breadcrumb() {
  return (
    <div className="max-w-[920px] mx-auto px-6 lg:px-0 pt-10">
      <Link
        href="/blog"
        className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        ← back to writing
      </Link>
    </div>
  );
}

function ArticleHeader({ post }: { post: PostView }) {
  return (
    <header className="max-w-[760px] mx-auto px-6 lg:px-0 mb-10">
      <ArticleMeta post={post} />
      <h1
        className="font-serif text-(--color-ink) text-[clamp(40px,5.6vw,64px)] font-[380] tracking-[-0.022em] leading-[1.04]"
        data-testid="blog-article-title"
      >
        {post.title}
      </h1>
      <p className="italic text-(--color-muted) mt-6 max-w-[34em] text-[22px] leading-[1.45] font-[380]">
        {post.excerpt}
      </p>
    </header>
  );
}

function ArticleMeta({ post }: { post: PostView }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-4 flex items-baseline gap-3 flex-wrap">
      <span>{formatDate(post.published_at)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{post.read_minutes} min read</span>
      {post.tags.map((t) => <TagLink key={t} tag={t} />)}
    </div>
  );
}

function TagLink({ tag }: { tag: string }) {
  return (
    <Link
      href={`/blog?tag=${encodeURIComponent(tag)}`}
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
  const rendered = expandURIsToURLs(bodyMD, assetURLs);
  return (
    <article
      className={`max-w-[680px] mx-auto px-6 lg:px-0 text-(--color-ink) ${markdownStyles.body}`}
      data-testid="blog-article-body"
    >
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {rendered}
      </Markdown>
    </article>
  );
}

function LockedView({ post }: { post: PostView }) {
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <main className="max-w-[760px] mx-auto px-6 lg:px-0 py-20 text-center">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
          private essay
        </div>
        <h1 className="font-serif text-(--color-ink) text-[clamp(36px,5vw,56px)] font-[380] tracking-[-0.018em] leading-[1.05]">
          {post.title}<span className="text-(--color-accent)">.</span>
        </h1>
        <p className="text-(--color-muted) mt-6 max-w-[34em] mx-auto text-[18px]">
          {post.locked_body ?? 'This essay is gated; ask for an invite code.'}
        </p>
        <LockedActions />
      </main>
    </div>
  );
}

function LockedActions() {
  return (
    <div className="mt-8 flex flex-wrap items-baseline justify-center gap-4">
      <Link
        href="/gate#request"
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors"
      >
        request an invite code →
      </Link>
      <Link
        href="/blog"
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        ← back to writing
      </Link>
    </div>
  );
}

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '.') : '';
}
