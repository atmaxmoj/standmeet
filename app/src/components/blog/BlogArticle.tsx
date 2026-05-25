// BlogArticle —— 单篇文章；Stripe-Press 风密度 (680px 单栏 / 21px 字号 /
// 1.65 行高)。private 文章按 visibility 锁。

import Link from 'next/link';

import type { PostBlock, PostView } from '@/lib/api/public';
import { Cover } from '@/components/blog/Cover';

interface Props {
  post: PostView;
}

export function BlogArticle({ post }: Props) {
  return isLocked(post) ? <LockedView post={post} /> : <UnlockedView post={post} />;
}

function isLocked(post: PostView): boolean {
  return post.visibility === 'private' && !hasBody(post);
}

function hasBody(post: PostView): boolean {
  return (post.body?.length ?? 0) > 0;
}

function UnlockedView({ post }: { post: PostView }) {
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <ArticleTopBar />
      <main className="pb-24">
        <Breadcrumb />
        <div className="max-w-[920px] mx-auto px-6 lg:px-0 mt-6 mb-12">
          <Cover cover={post} no={formatDate(post.published_at) + ' · essay'} />
        </div>
        <ArticleHeader post={post} />
        <Body blocks={post.body} />
      </main>
    </div>
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
        className="font-serif text-(--color-ink)"
        style={{
          fontSize: 'clamp(40px, 5.6vw, 64px)', fontWeight: 380,
          letterSpacing: '-0.022em', lineHeight: 1.04,
        }}
        data-testid="blog-article-title"
      >
        {post.title}
      </h1>
      <p
        className="italic text-(--color-muted) mt-6 max-w-[34em]"
        style={{ fontSize: '22px', lineHeight: 1.45, fontWeight: 380 }}
      >
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

function Body({ blocks }: { blocks: PostBlock[] }) {
  return (
    <article
      className="max-w-[680px] mx-auto px-6 lg:px-0 text-(--color-ink)"
      data-testid="blog-article-body"
    >
      {blocks.map((b, i) => <BlockEl key={i} block={b} />)}
    </article>
  );
}

function BlockEl({ block }: { block: PostBlock }) {
  return block.kind === 'h'
    ? <HeadingBlock text={block.text} />
    : block.kind === 'pull'
      ? <PullBlock text={block.text} />
      : <ParaBlock text={block.text} />;
}

function HeadingBlock({ text }: { text: string }) {
  return (
    <h2
      className="font-serif"
      style={{
        fontSize: '28px', fontWeight: 500, letterSpacing: '-0.012em',
        margin: '2.6em 0 0.6em', lineHeight: 1.25,
      }}
    >
      {text}
    </h2>
  );
}

function PullBlock({ text }: { text: string }) {
  return (
    <blockquote
      className="italic"
      style={{
        fontSize: '26px', lineHeight: 1.4, letterSpacing: '-0.008em',
        color: 'var(--color-ink)', margin: '2.4em -28px',
        padding: '4px 28px',
        borderLeft: '3px solid var(--color-accent)',
      }}
    >
      {text}
    </blockquote>
  );
}

function ParaBlock({ text }: { text: string }) {
  return (
    <p style={{ fontSize: '21px', lineHeight: 1.65, marginBottom: '1.4em' }}>
      {text}
    </p>
  );
}

function LockedView({ post }: { post: PostView }) {
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <main className="max-w-[760px] mx-auto px-6 lg:px-0 py-20 text-center">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
          private essay
        </div>
        <h1
          className="font-serif text-(--color-ink)"
          style={{
            fontSize: 'clamp(36px, 5vw, 56px)', fontWeight: 380,
            letterSpacing: '-0.018em', lineHeight: 1.05,
          }}
        >
          {post.title}<span className="text-(--color-accent)">.</span>
        </h1>
        <p
          className="text-(--color-muted) mt-6 max-w-[34em] mx-auto"
          style={{ fontSize: '18px' }}
        >
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
