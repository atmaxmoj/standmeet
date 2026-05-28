// BlogIndex —— /blog 落地。time-desc lead + archive list + tag chip
// filter + infinite scroll (BlogScrollLoader)。
//
// `?tag=<name>` 走 URLSearchParams (真 sharable)，posts 走 zustand。
// 设计源自 blog.js IndexView。

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import type { PostView } from '@/lib/api/public';
import { BlogScrollLoader } from '@/components/blog/BlogScrollLoader';
import { PostCardLead, PostRow } from '@/components/blog/BlogPostCards';
import { FloatingChatDock } from '@/components/visitor/FloatingChatDock';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { useBlogFeed } from '@/lib/blog/use-blog-feed';

interface Props {
  initialPosts: PostView[];
  initialCursor?: string;
}

export function BlogIndex({ initialPosts, initialCursor }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const activeTag = params.get('tag');
  const feed = useBlogFeed();
  useFeedHydration(initialPosts, initialCursor);
  const filtered = filterByTag(feed.posts, activeTag);
  const pickTag = (t: string | null) => navigateTag(router, t);
  return (
    <div className="min-h-screen bg-(--color-paper) text-(--color-ink) font-serif">
      <SessionStrip />
      <BlogTopBar />
      <main className="max-w-[1080px] mx-auto px-6 lg:px-0 pb-24">
        <BlogIndexHeader
          posts={feed.posts}
          activeTag={activeTag}
          onPickTag={pickTag}
          filteredCount={filtered.length}
        />
        <BlogIndexBody activeTag={activeTag} posts={filtered} onPickTag={pickTag} />
        <BlogScrollLoader done={feed.done} loading={feed.loading} onHit={feed.loadMore} />
        <AskCorpusCTA hasPosts={feed.posts.length > 0} />
        <RecommendedRail posts={feed.posts} />
      </main>
      <FloatingChatDock />
    </div>
  );
}

// AskCorpusCTA —— blog index 末尾的"or skip the reading"，引 visitor 回 `/`
// 直接跟 AI 聊；只有有文章时才显示（空 corpus 不引）。design 源:
// docs/design/project/blog.js IndexView 末段 (366-388)。
function AskCorpusCTA({ hasPosts }: { hasPosts: boolean }) {
  return hasPosts ? (
    <section className="mt-24 pt-10 border-t border-(--color-rule)">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-10 items-baseline">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
            or skip the reading
          </div>
          <h3 className="font-serif text-(--color-ink) text-[30px] leading-[1.15] tracking-[-0.012em] font-normal">
            Ask the AI directly<span className="text-(--color-accent)">.</span>
          </h3>
          <p className="reading text-(--color-muted) mt-3 text-[17px]">
            Everything you&apos;d read here, said back to you in the owner&apos;s voice.
            The chat covers ground he hasn&apos;t written up yet, and answers from the
            corpus rather than the archive.
          </p>
        </div>
        <div className="md:pl-10">
          <Link
            href="/"
            className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-ink) border border-(--color-ink) px-4 py-3 inline-block hover:bg-(--color-ink) hover:text-(--color-paper) transition-colors"
          >
            <span data-testid="blog-ask-cta">open the chat →</span>
          </Link>
        </div>
      </div>
    </section>
  ) : null;
}

function RecommendedRail({ posts }: { posts: PostView[] }) {
  const recommended = posts.slice(0, 2);
  return recommended.length >= 2 ? (
    <section className="mt-16 pt-8 border-t border-(--color-rule)">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-5">
        if you only read two
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {recommended.map((p) => (
          <RecommendedCard key={p.slug} post={p} />
        ))}
      </div>
    </section>
  ) : null;
}

function RecommendedCard({ post }: { post: PostView }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="block border border-(--color-rule) rounded-[3px] p-5 hover:border-(--color-ink) transition-colors"
    >
      <h4 className="font-serif text-[18px] text-(--color-ink) font-normal leading-[1.3] mb-2">
        {post.title}
      </h4>
      <p className="reading text-[14px] text-(--color-muted) line-clamp-2">{post.excerpt}</p>
      <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-3">
        {post.read_minutes} min read
      </div>
    </Link>
  );
}

function filterByTag(posts: PostView[], tag: string | null): PostView[] {
  return tag ? posts.filter((p) => p.tags.includes(tag)) : posts;
}

function useFeedHydration(initialPosts: PostView[], initialCursor?: string) {
  const hydrate = useBlogFeed((s) => s.hydrate);
  useEffect(() => {
    hydrate(initialPosts, initialCursor);
  }, [initialPosts, initialCursor, hydrate]);
}

function navigateTag(router: ReturnType<typeof useRouter>, tag: string | null) {
  const qs = new URLSearchParams();
  tag && qs.set('tag', tag);
  const suffix = qs.toString();
  router.push('/blog' + (suffix ? '?' + suffix : ''));
}

function BlogTopBar() {
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <Link href="/" className="text-(--color-ink)">standmeet</Link>
        <span className="text-(--color-faint) mx-1">·</span>
        <span className="text-(--color-accent)">writing</span>
      </div>
      <Link
        href="/"
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        chat
      </Link>
    </header>
  );
}

function BlogIndexHeader({
  posts, activeTag, onPickTag, filteredCount,
}: {
  posts: PostView[];
  activeTag: string | null;
  filteredCount: number;
  onPickTag: (t: string | null) => void;
}) {
  return (
    <section className="pt-12 lg:pt-16 pb-8 border-b border-(--color-rule)">
      <BlogTitleBlock />
      <BlogTagBar
        posts={posts}
        activeTag={activeTag}
        filteredCount={filteredCount}
        onPickTag={onPickTag}
      />
    </section>
  );
}

function BlogTitleBlock() {
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-5">essays</div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(48px,7vw,80px)] font-[380] tracking-[-0.022em] leading-[0.98]">
        Writing<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="italic text-(--color-muted) mt-5 max-w-[34em] text-[21px] leading-[1.45] font-[380]">
        The corpus, surfaced. Each essay is the expanded version of something I&apos;ve been
        thinking through — you can ask the AI about any of these directly.
      </p>
    </>
  );
}

function BlogTagBar({
  posts, activeTag, filteredCount, onPickTag,
}: {
  posts: PostView[];
  activeTag: string | null;
  filteredCount: number;
  onPickTag: (t: string | null) => void;
}) {
  return (
    <div className="mt-8">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <span>browse by tag</span>
        <ClearTagButton
          activeTag={activeTag}
          filteredCount={filteredCount}
          totalCount={posts.length}
          onClear={() => onPickTag(null)}
        />
      </div>
      <TagChipRow posts={posts} active={activeTag} onPick={onPickTag} />
    </div>
  );
}

function ClearTagButton({
  activeTag, filteredCount, totalCount, onClear,
}: {
  activeTag: string | null;
  filteredCount: number;
  totalCount: number;
  onClear: () => void;
}) {
  return activeTag ? (
    <button
      type="button"
      onClick={onClear}
      className="text-(--color-faint) hover:text-(--color-ink) lowercase tracking-[0.06em] text-[10px]"
    >
      × clear · showing {filteredCount} of {totalCount}
    </button>
  ) : null;
}

function TagChipRow({
  posts, active, onPick,
}: {
  posts: PostView[];
  active: string | null;
  onPick: (t: string | null) => void;
}) {
  const counts = countTags(posts);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return (
    <div className="flex flex-wrap items-baseline gap-1.5" data-testid="blog-tag-row">
      <ChipButton active={!active} onClick={() => onPick(null)}>
        all <span className="ml-1 opacity-60 tabular-nums">{posts.length}</span>
      </ChipButton>
      {tags.map((t) => (
        <ChipButton
          key={t}
          active={active === t}
          testid={`blog-tag-${t}`}
          onClick={() => onPick(active === t ? null : t)}
        >
          {t} <span className="ml-1 opacity-60 tabular-nums">{counts.get(t) ?? 0}</span>
        </ChipButton>
      ))}
    </div>
  );
}

function countTags(posts: PostView[]): Map<string, number> {
  const counts = new Map<string, number>();
  posts.forEach((p) => p.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  return counts;
}

function ChipButton({
  active, onClick, testid, children,
}: { active: boolean; onClick: () => void; testid?: string; children: React.ReactNode }) {
  const cls = active
    ? 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)'
    : 'text-(--color-muted) border-(--color-rule) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={`mono text-[10.5px] tracking-[0.05em] uppercase border px-2 py-0.5 rounded-[2px] ${cls}`}
    >
      {children}
    </button>
  );
}

function BlogIndexBody({
  activeTag, posts, onPickTag,
}: {
  activeTag: string | null;
  posts: PostView[];
  onPickTag: (t: string | null) => void;
}) {
  return posts.length === 0
    ? <EmptyState />
    : <PopulatedBody activeTag={activeTag} posts={posts} onPickTag={onPickTag} />;
}

function EmptyState() {
  return (
    <section className="py-20 text-center" data-testid="blog-empty">
      <p className="italic text-(--color-muted) text-[18px]">No essays yet.</p>
    </section>
  );
}

function PopulatedBody({
  activeTag, posts, onPickTag,
}: {
  activeTag: string | null;
  posts: PostView[];
  onPickTag: (t: string | null) => void;
}) {
  return activeTag
    ? <FilteredList tag={activeTag} posts={posts} />
    : <LeadAndArchive posts={posts} onPickTag={onPickTag} />;
}

function LeadAndArchive({
  posts, onPickTag,
}: {
  posts: PostView[];
  onPickTag: (t: string) => void;
}) {
  const lead = posts[0];
  return lead
    ? <LeadAndArchiveContent lead={lead} rest={posts.slice(1)} onPickTag={onPickTag} />
    : <EmptyState />;
}

function LeadAndArchiveContent({
  lead, rest, onPickTag,
}: {
  lead: PostView;
  rest: PostView[];
  onPickTag: (t: string) => void;
}) {
  return (
    <>
      <section className="pt-12">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-7">most recent</div>
        <PostCardLead post={lead} onPickTag={onPickTag} />
      </section>
      <section className="mt-4">
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">archive</div>
        {rest.map((p, i) => <PostRow key={p.slug} post={p} idx={i + 2} />)}
      </section>
    </>
  );
}

function FilteredList({ tag, posts }: { tag: string; posts: PostView[] }) {
  return (
    <section className="pt-10">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2 flex items-baseline gap-3">
        <span>filtered by</span>
        <span className="text-(--color-accent)">#{tag}</span>
        <span className="text-(--color-faint)">·</span>
        <span className="tabular-nums">
          {posts.length} essay{posts.length === 1 ? '' : 's'}
        </span>
      </div>
      <div>
        {posts.map((p, i) => <PostRow key={p.slug} post={p} idx={i + 1} />)}
      </div>
    </section>
  );
}
