// PostsSection —— /admin/posts。owner 手写 markdown post。MCP handoff
// 同一套 backend，所以这里只是给 owner 不开 Claude Desktop 时的一条
// 备用路径。设计简单：list (publish 状态 chip + delete) + 新建 modal。

'use client';

import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import { usePosts, type PostsHook, type AdminPostView, type CreatePostInput } from '@/lib/admin/use-posts';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function PostsSection() {
  const hook = usePosts();
  const [creating, setCreating] = useState(false);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="surface · writing"
        title="posts"
        count={titleCount(hook)}
        action={<Btn kind="primary" onClick={() => setCreating(true)}>＋ new post</Btn>}
      />
      <Intro />
      <PostsListBody hook={hook} />
      {creating && (
        <PostCreateModal
          onClose={() => setCreating(false)}
          onCreate={hook.createPost}
        />
      )}
    </>
  );
}

function titleCount(hook: PostsHook): string {
  return hook.status === 'ready' ? `${hook.posts.length} posts` : '';
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Owner-curated blog posts. Hand-write in markdown below — `## h2` becomes a section break, `&gt; quote`
      becomes a pull-quote, anything else is a paragraph. Or hand off to Claude via the
      `post_create` MCP tool; both end up in the same place.
    </p>
  );
}

function PostsListBody({ hook }: { hook: PostsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading
    ? <CardGridSkeleton />
    : <PostsListReady hook={hook} />;
}

function PostsListReady({ hook }: { hook: PostsHook }) {
  return hook.posts.length === 0
    ? <EmptyState />
    : <PostList hook={hook} />;
}

function EmptyState() {
  return (
    <p className="reading italic text-(--color-muted)" data-testid="post-list">
      No posts yet.
    </p>
  );
}

function PostList({ hook }: { hook: PostsHook }) {
  return (
    <ul className="flex flex-col gap-4" data-testid="post-list">
      {hook.posts.map((p) => (
        <li key={p.id} data-testid={`post-row-${p.slug}`}>
          <PostCard post={p} hook={hook} />
        </li>
      ))}
    </ul>
  );
}

function PostCard({ post, hook }: { post: AdminPostView; hook: PostsHook }) {
  return (
    <div className="border border-(--color-rule) px-5 py-4 flex flex-col gap-2">
      <PostCardHead post={post} />
      {post.excerpt && (
        <p className="reading-tight text-[14px] text-(--color-muted)">{post.excerpt}</p>
      )}
      <PostCardActions post={post} hook={hook} />
    </div>
  );
}

function PostCardHead({ post }: { post: AdminPostView }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-serif text-[18px]">{post.title}</span>
      <span className="mono text-[10px] text-(--color-faint)">/{post.slug}</span>
      <span
        className={`mono text-[9px] tracking-[0.18em] uppercase ${post.published ? 'text-(--color-accent)' : 'text-(--color-muted)'}`}
        data-testid={`post-status-${post.slug}`}
      >
        {post.published ? 'published' : 'draft'}
      </span>
    </div>
  );
}

function PostCardActions({ post, hook }: { post: AdminPostView; hook: PostsHook }) {
  const toast = useToast();
  const togglePublish = useTogglePublish(post, hook, toast);
  const handleDelete = useHandleDelete(post.id, hook, toast);
  return (
    <div className="flex items-baseline gap-3 mt-1">
      <button
        type="button"
        onClick={() => void togglePublish()}
        data-testid={`post-toggle-publish-${post.slug}`}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {post.published ? 'unpublish' : 'publish'}
      </button>
      <span className="text-(--color-faint)">·</span>
      <button
        type="button"
        onClick={() => void handleDelete()}
        data-testid={`post-delete-${post.slug}`}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      >
        delete
      </button>
    </div>
  );
}

function useTogglePublish(
  post: AdminPostView, hook: PostsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    await runTogglePublish(post, hook, toast);
  }, [post, hook, toast]);
}

async function runTogglePublish(
  post: AdminPostView, hook: PostsHook, toast: ReturnType<typeof useToast>,
): Promise<void> {
  const ok = await flipPublishOp(post, hook);
  ok && toast.success(publishedVerb(post.published));
}

function flipPublishOp(post: AdminPostView, hook: PostsHook): Promise<boolean> {
  return post.published ? hook.unpublishPost(post.id) : hook.publishPost(post.id);
}

function publishedVerb(currentlyPublished: boolean): string {
  return currentlyPublished ? 'Unpublished' : 'Published';
}

function useHandleDelete(
  id: string, hook: PostsHook, toast: ReturnType<typeof useToast>,
) {
  return useCallback(async () => {
    const ok = await hook.deletePost(id);
    ok && toast.success('Post deleted');
  }, [hook, id, toast]);
}

function PostCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreatePostInput) => Promise<boolean>;
}) {
  return (
    <div
      className="fixed inset-0 bg-(--color-ink)/40 flex items-center justify-center z-40 p-6"
      data-testid="post-create-modal"
    >
      <PostCreateForm onClose={onClose} onCreate={onCreate} />
    </div>
  );
}

function PostCreateForm({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreatePostInput) => Promise<boolean>;
}) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [bodyMD, setBodyMD] = useState('');
  const [coverHeadline, setCoverHeadline] = useState('');
  const [coverSub, setCoverSub] = useState('');
  const [coverHue, setCoverHue] = useState<'amber' | 'violet' | 'acid'>('amber');
  const [tags, setTags] = useState('');
  const [publish, setPublish] = useState(true);
  const toast = useToast();
  const submit = useSubmitPost(
    { slug, title, excerpt, bodyMD, coverHeadline, coverSub, coverHue, tags, publish },
    { onCreate, onClose, toast },
  );
  return (
    <div className="bg-(--color-paper) border border-(--color-rule) max-w-[720px] w-full max-h-[90vh] overflow-y-auto p-7 flex flex-col gap-4">
      <h2 className="font-serif text-[22px]">new post</h2>
      <PostFieldRow>
        <PostField label="slug" value={slug} onChange={setSlug} placeholder="url-slug" />
        <PostField label="title" value={title} onChange={setTitle} placeholder="Post title" />
      </PostFieldRow>
      <PostField label="excerpt" value={excerpt} onChange={setExcerpt} placeholder="One-line summary" />
      <PostFieldRow>
        <PostField label="cover headline" value={coverHeadline} onChange={setCoverHeadline} placeholder="Big headline" />
        <PostField label="cover sub" value={coverSub} onChange={setCoverSub} placeholder="Italic subline" />
      </PostFieldRow>
      <PostFieldRow>
        <CoverHueSelect value={coverHue} onChange={setCoverHue} />
        <PostField label="tags" value={tags} onChange={setTags} placeholder="comma, separated" />
      </PostFieldRow>
      <PostBodyField value={bodyMD} onChange={setBodyMD} />
      <PostCreateFooter publish={publish} onTogglePublish={() => setPublish(!publish)} onClose={onClose} onSubmit={() => void submit()} />
    </div>
  );
}

interface PostFormFields {
  slug: string;
  title: string;
  excerpt: string;
  bodyMD: string;
  coverHeadline: string;
  coverSub: string;
  coverHue: 'amber' | 'violet' | 'acid';
  tags: string;
  publish: boolean;
}

interface PostSubmitDeps {
  onCreate: (input: CreatePostInput) => Promise<boolean>;
  onClose: () => void;
  toast: ReturnType<typeof useToast>;
}

function useSubmitPost(fields: PostFormFields, deps: PostSubmitDeps) {
  return useCallback(async () => {
    isValidFormFields(fields) && await runSubmitPost(fields, deps);
  }, [fields, deps]);
}

function isValidFormFields(f: PostFormFields): boolean {
  return f.slug !== '' && f.title !== '';
}

async function runSubmitPost(fields: PostFormFields, deps: PostSubmitDeps): Promise<void> {
  const ok = await deps.onCreate(buildCreatePayload(fields));
  ok && onSubmitSuccess(fields, deps);
}

function onSubmitSuccess(fields: PostFormFields, deps: PostSubmitDeps): void {
  const verb = fields.publish ? 'published' : 'saved as draft';
  deps.toast.success(`Post ${fields.slug} ${verb}`);
  deps.onClose();
}

function buildCreatePayload(f: PostFormFields): CreatePostInput {
  return {
    slug: f.slug, title: f.title, excerpt: f.excerpt, body_md: f.bodyMD,
    cover_headline: f.coverHeadline, cover_sub: f.coverSub, cover_hue: f.coverHue,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    visibility: 'public', cross_refs: [], locked_body: '', publish: f.publish,
  };
}

function PostFieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

function PostField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`post-field-${label.replace(/ /g, '-')}`}
      />
    </label>
  );
}

function CoverHueSelect({
  value, onChange,
}: { value: 'amber' | 'violet' | 'acid'; onChange: (v: 'amber' | 'violet' | 'acid') => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">cover hue</span>
      <select
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        onChange={(e) => onChange(e.target.value as 'amber' | 'violet' | 'acid')}
        data-testid="post-field-cover-hue"
      >
        <option value="amber">amber</option>
        <option value="violet">violet</option>
        <option value="acid">acid</option>
      </select>
    </label>
  );
}

function PostBodyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        body (markdown)
      </span>
      <textarea
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[13px] font-mono min-h-[260px]"
        value={value}
        placeholder={'Paragraph.\n\n## Heading\n\nAnother paragraph.\n\n> Pull-quote.'}
        onChange={(e) => onChange(e.target.value)}
        data-testid="post-field-body"
      />
    </label>
  );
}

function PostCreateFooter({
  publish, onTogglePublish, onClose, onSubmit,
}: {
  publish: boolean;
  onTogglePublish: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex justify-between items-baseline mt-2">
      <label className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) flex items-baseline gap-2">
        <input
          type="checkbox"
          checked={publish}
          onChange={onTogglePublish}
          data-testid="post-field-publish"
        />
        publish immediately
      </label>
      <div className="flex gap-3">
        <Btn kind="ghost" onClick={onClose}>cancel</Btn>
        <button
          type="button"
          data-testid="post-create-submit"
          onClick={onSubmit}
          className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors"
        >
          create
        </button>
      </div>
    </div>
  );
}
