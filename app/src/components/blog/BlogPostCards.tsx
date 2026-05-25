// BlogPostCards —— /blog index 用到的 lead card + archive row + lead meta。
// 从 BlogIndex 拆出来守 350-line cap。

'use client';

import Link from 'next/link';

import type { PostView } from '@/lib/api/public';
import { Cover } from '@/components/blog/Cover';

export function PostCardLead({
  post, onPickTag,
}: { post: PostView; onPickTag: (t: string) => void }) {
  return (
    <article
      className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-10 lg:gap-12 mb-20 group"
      data-blog-card={post.slug}
    >
      <Link href={`/blog/${post.slug}`} className="block">
        <Cover
          cover={post}
          assetURLs={post.asset_urls ?? {}}
          no={'no. 01 · ' + formatDate(post.published_at)}
        />
      </Link>
      <PostCardLeadMeta post={post} onPickTag={onPickTag} />
    </article>
  );
}

function PostCardLeadMeta({
  post, onPickTag,
}: { post: PostView; onPickTag: (t: string) => void }) {
  return (
    <div className="flex flex-col">
      <PostCardLeadKicker post={post} />
      <Link href={`/blog/${post.slug}`}>
        <h2 className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[clamp(34px,4vw,46px)] leading-[1.08] tracking-[-0.018em] font-normal">
          {post.title}
        </h2>
      </Link>
      <p className="text-(--color-muted) mt-5 text-[18px] leading-[1.55]">
        {post.excerpt}
      </p>
      <PostCardLeadTagRow post={post} onPickTag={onPickTag} />
    </div>
  );
}

function PostCardLeadKicker({ post }: { post: PostView }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3 flex-wrap">
      <span className="text-(--color-ink)">latest</span>
      <span className="text-(--color-faint)">·</span>
      <span>{formatDate(post.published_at)}</span>
      <span className="text-(--color-faint)">·</span>
      <span>{post.read_minutes} min read</span>
    </div>
  );
}

function PostCardLeadTagRow({
  post, onPickTag,
}: { post: PostView; onPickTag: (t: string) => void }) {
  return (
    <div className="mt-6 flex flex-wrap items-baseline gap-1.5">
      {post.tags.map((t) => <TagPill key={t} tag={t} onClick={() => onPickTag(t)} />)}
      <span className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) ml-auto pt-1">
        read →
      </span>
    </div>
  );
}

function TagPill({ tag, onClick }: { tag: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mono text-[10.5px] tracking-[0.05em] uppercase border border-(--color-rule) text-(--color-muted) px-2 py-0.5 rounded-[2px] hover:text-(--color-ink)"
    >
      {tag}
    </button>
  );
}

export function PostRow({ post, idx }: { post: PostView; idx: number }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group grid grid-cols-[60px_1fr_auto] gap-6 lg:gap-10 py-7 border-t border-(--color-rule) items-baseline"
    >
      <div
        data-blog-card={post.slug}
        className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) tabular-nums pt-2"
      >
        no. {String(idx).padStart(2, '0')}
      </div>
      <PostRowBody post={post} />
      <div className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-muted) group-hover:text-(--color-accent) pt-2 shrink-0">
        read →
      </div>
    </Link>
  );
}

function PostRowBody({ post }: { post: PostView }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline gap-3 flex-wrap">
        <span>{formatDate(post.published_at)}</span>
        <span className="text-(--color-faint)">·</span>
        <span>{post.read_minutes} min</span>
      </div>
      <h3 className="font-serif text-(--color-ink) group-hover:text-(--color-accent) transition-colors text-[24px] leading-[1.2] tracking-[-0.005em] font-normal">
        {post.title}
      </h3>
      <p className="text-(--color-muted) mt-2 max-w-[46em] text-[16.5px] leading-[1.5]">
        {post.excerpt}
      </p>
    </div>
  );
}

function formatDate(iso?: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, '.') : '';
}
